const Graph = require('ipld-graph-builder')
const Message = require('primea-message')
const Kernel = require('./kernel.js')
const Scheduler = require('./scheduler.js')
const DFSchecker = require('./dfsChecker.js')
const chunk = require('chunk')

module.exports = class Hypervisor {
  /**
   * The Hypervisor manages the container instances by instantiating them and
   * destorying them when possible. It also facilitates localating Containers
   * @param {Graph} dag an instance of [ipfs.dag](https://github.com/ipfs/interface-ipfs-core/tree/master/API/dag#dag-api)
   * @param {object} state - the starting state
   */
  constructor (dag, state = {}) {
    this.graph = new Graph(dag)
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
  getDestPort (port) {
    if (port.destPort) {
      return port.destPort
    } else {
      return this.graph.get(this.state, `${port.destId}/ports/${port.destName}`)
    }
  }

  async send (port, message) {
    if (port.destId) {
      const id = port.destId
      const instance = await this.getInstance(id)
      return instance.queue(port.destName, message)
    } else {
      // port is unbound
      port.destPort.messages.push(message)
    }
  }

  // loads an instance of a container from the state
  async _loadInstance (id) {
    const state = await this.graph.get(this.state, id)
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
    const resolve = this.scheduler.getLock(id)
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

    // save the container in the state
    await this.graph.set(this.state, idHash, state)
    // create the container instance
    const instance = await this._loadInstance(idHash)
    resolve(instance)
    // send the intialization message
    await instance.initialize(message)

    if (state.code && state.code.length > this.MAX_DATA_BYTES) {
      state.code = chunk(state.code, this.MAX_DATA_BYTES).map(chk => {
        return {
          '/': chk
        }
      })
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
    const unlinked = await DFSchecker(this.graph, this.state, this.ROOT_ID, this._nodesToCheck)
    unlinked.forEach(id => {
      delete this.state[id]
    })
    return this.graph.flush(this.state)
  }

  /**
   * regirsters a container with the hypervisor
   * @param {String} type - the name of the type
   * @param {Class} Constructor - a Class for instantiating the container
   * @param {*} args - any args that the contructor takes
   */
  registerContainer (type, Constructor, args) {
    Constructor.type = type
    this._containerTypes[type] = {
      Constructor: Constructor,
      args: args
    }
  }
}
