const Actor = require('./actor.js')
const Scheduler = require('./scheduler.js')
const {ID} = require('./systemObjects.js')

module.exports = class Hypervisor {
  /**
   * The Hypervisor manages the container instances by instantiating them and
   * destorying them when possible. It also facilitates localating Containers
   * @param {Tree} tree - a [radix tree](https://github.com/dfinity/js-dfinity-radix-tree) to store the state
   */
  constructor (tree, nonce = 0) {
    this.tree = tree
    this.scheduler = new Scheduler(this)
    this._containerTypes = {}
    this.nonce = nonce
  }

  /**
   * sends a message
   * @param {Object} cap - the capabilitly used to send the message
   * @param {Object} message - the [message](https://github.com/primea/js-primea-message) to send
   * @returns {Promise} a promise that resolves once the receiving container is loaded
   */
  send (messages) {
    if (!Array.isArray(messages)) {
      messages = [messages]
    }
    this.scheduler.queue(messages)
  }

  async loadActor (id) {
    const state = await this.tree.getSubTree(id.id)
    const code = state.get(Buffer.from([0]))
    const {type, nonce} = Actor.deserializeMetaData(state.root['/'][3])
    const Container = this._containerTypes[type]

    // create a new actor instance
    const actor = new Actor({
      hypervisor: this,
      state,
      Container,
      id,
      nonce,
      type,
      code,
      cachedb: this.tree.dag._dag
    })

    await actor.startup()
    return actor
  }

  /**
   * creates an instance of an Actor
   * @param {Integer} type - the type id for the container
   * @param {Object} message - an intial [message](https://github.com/primea/js-primea-message) to send newly created actor
   * @param {Object} id - the id for the actor
   */
  async createActor (type, code, id = {nonce: this.nonce++, parent: null}) {
    const Container = this._containerTypes[type]
    const encoded = encodedID(id)
    let idHash = await this._getHashFromObj(encoded)
    idHash = new ID(idHash)
    const module = await Container.onCreation(code, idHash, this.tree)
    const metaData = Actor.serializeMetaData(type)

    // save the container in the state
    this.tree.set(idHash.id, metaData)
    if (code) {
      this.tree.set(Buffer.concat([idHash.id, Buffer.from([0])]), code)
    }
    return {
      id: idHash,
      module: module
    }
  }

  // get a hash from a POJO
  _getHashFromObj (obj) {
    return this.tree.constructor.getMerkleLink(obj)
  }

  /**
   * creates a state root starting from a given container and a given number of
   * ticks
   * @param {Number} ticks the number of ticks at which to create the state root
   * @returns {Promise}
   */
  createStateRoot () {
    return new Promise((resolve, reject) => {
      this.scheduler.on('idle', () => {
        this.tree.flush().then(resolve)
      })
    })
  }

  /**
   * regirsters a container with the hypervisor
   * @param {Class} Constructor - a Class for instantiating the container
   * @param {*} args - any args that the contructor takes
   * @param {Integer} typeId - the container's type identification ID
   */
  registerContainer (Constructor) {
    this._containerTypes[Constructor.typeId] = Constructor
  }
}

function encodedID (id) {
  const nonce = Buffer.from([id.nonce])
  if (id.parent) {
    return Buffer.concat([nonce, id.parent.id])
  } else {
    return nonce
  }
}
