const Tree = require('merkle-radix-tree')
const Graph = require('ipld-graph-builder')
const chunk = require('chunk')
const Message = require('primea-message')
const Kernel = require('./kernel.js')
const Scheduler = require('./scheduler.js')
const DFSchecker = require('./dfsChecker.js')

module.exports = class Hypervisor {
  /**
   * The Hypervisor manages the container instances by instantiating them and
   * destorying them when possible. It also facilitates localating Containers
   * @param {Graph} dag an instance of [ipfs.dag](https://github.com/ipfs/interface-ipfs-core/tree/master/API/dag#dag-api)
   * @param {object} state - the starting state
   */
  constructor (dag, state = {'/': Tree.emptyTreeState}) {
    this.graph = new Graph(dag)
    this.tree = new Tree({
      graph: this.graph,
      root: state
    })
    this.scheduler = new Scheduler()
    this.state = state
    this._containerTypes = {}
    this._nodesToCheck = new Set()

    this.ROOT_ID = 'zdpuAm6aTdLVMUuiZypxkwtA7sKm7BWERy8MPbaCrFsmiyzxr'
    this.MAX_DATA_BYTES = 65533
  }

  /**
   * add a potaintail node in the state graph to check for garbage collection
   * @param {string} id
   */
  addNodeToCheck (id) {
    this._nodesToCheck.add(id)
  }

  /**
   * given a port, this finds the corridsponeding endpoint port of the channel
   * @param {object} port
   * @returns {Promise}
   */
  async getDestPort (port) {
    if (port.destPort) {
      return port.destPort
    } else {
      const containerState = await this.tree.get(port.destId)
      return this.graph.get(containerState, `ports/${port.destName}`)
    }
  }

  async send (port, message) {
    if (port.destId) {
      const id = port.destId
      const instance = await this.getInstance(id)
      instance.queue(port.destName, message)
    } else {
      // port is unbound
      port.destPort.messages.push(message)
    }
  }

  // loads an instance of a container from the state
  async _loadInstance (id, state) {
    if (!state) {
      state = await this.tree.get(id)
    }
    const container = this._containerTypes[state.type]
    let code

    // checks if the code stored in the state is an array and that the elements
    // are merkle link
    if (state.code && state.code[0]['/']) {
      await this.graph.tree(state.code, 1)
      code = state.code.map(a => a['/']).reduce((a, b) => a + b)
    } else {
      code = state.code
    }

    // create a new kernel instance
    const kernel = new Kernel({
      hypervisor: this,
      state: state,
      code: code,
      container: container,
      id: id
    })

    // save the newly created instance
    this.scheduler.update(kernel)
    return kernel
  }

  // get a hash from a POJO
  _getHashFromObj (obj) {
    return this.graph.flush(obj).then(obj => obj['/'])
  }

  /**
   * gets an existsing container instances
   * @param {string} id - the containers ID
   * @returns {Promise}
   */
  async getInstance (id) {
    let instance = this.scheduler.getInstance(id)
    if (instance) {
      return instance
    } else {
      const resolve = this.scheduler.getLock(id)
      const instance = await this._loadInstance(id)
      await instance.startup()
      resolve(instance)
      return instance
    }
  }

  /**
   * creates an new container instances and save it in the state
   * @param {string} type - the type of container to create
   * @param {*} code
   * @param {array} entryPorts
   * @param {object} id
   * @param {object} id.nonce
   * @param {object} id.parent
   * @returns {Promise}
   */
  async createInstance (type, message = new Message(), id = {nonce: 0, parent: null}) {
    // create a lock to prevent the scheduler from reloving waits before the
    // new container is loaded
    // const unlock = this.scheduler.getLock(id)
    const idHash = await this._getHashFromObj(id)
    // const code = message.data.byteLength ? message.data : undefined
    const state = {
      nonce: [0],
      ports: {},
      type: type
    }

    if (message.data.length) {
      state.code = message.data
    }

    // create the container instance
    const instance = await this._loadInstance(idHash, state)

    // send the intialization message
    await instance.create(message)

    if (Object.keys(instance.ports.ports).length || instance.id === this.ROOT_ID) {
      if (state.code && state.code.length > this.MAX_DATA_BYTES) {
        state.code = chunk(state.code, this.MAX_DATA_BYTES).map(chk => {
          return {
            '/': chk
          }
        })
      }
      // save the container in the state
      await this.tree.set(idHash, state)
    } else {
      this.scheduler.done(idHash)
    }

    return instance
  }

  /**
   * creates a state root starting from a given container and a given number of
   * ticks
   * @param {Number} ticks the number of ticks at which to create the state root
   * @returns {Promise}
   */
  async createStateRoot (ticks) {
    await this.scheduler.wait(ticks)

    const unlinked = await DFSchecker(this.tree, this.ROOT_ID, this._nodesToCheck)
    for (const id of unlinked) {
      await this.tree.delete(id)
    }

   // console.log(JSON.stringify(this.state, null, 2))
    return this.graph.flush(this.state)
  }

  /**
   * regirsters a container with the hypervisor
   * @param {Class} Constructor - a Class for instantiating the container
   * @param {*} args - any args that the contructor takes
   * @param {interger} typeId - the container's type identification ID
   */
  registerContainer (Constructor, args, typeId = Constructor.typeId) {
    this._containerTypes[typeId] = {
      Constructor: Constructor,
      args: args
    }
  }
}
