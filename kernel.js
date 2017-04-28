const PriorityQueue = require('fastpriorityqueue')
const EventEmitter = require('events')
const BN = require('bn.js')
const PortManager = require('./portManager.js')

module.exports = class Kernel extends EventEmitter {
  constructor (opts) {
    super()
    this._opts = opts
    this.state = opts.parentPort.link['/']
    this.vmState = 'idle'
    this.ticks = 0
    this.ports = new PortManager(this)
    this.vm = new opts.VM(this)
    this._waitingQueue = new PriorityQueue((a, b) => {
      return a.threshold > b.threshold
    })
    this.on('result', this._runNextMessage)
    this.on('idle', () => {
      while (!this._waitingQueue.isEmpty()) {
        this._waitingQueue.poll().resolve()
      }
    })
  }

  start () {
    return this.ports.start()
  }

  _updateVmState (vmState, message) {
    this.vmState = vmState
    this.emit(vmState, message)
  }

  queue (message) {
    this.ports.queue(message)
    if (this.vmState === 'idle') {
      this._updateVmState('running')
      this._runNextMessage()
    }
  }

  _runNextMessage () {
    this.ports.getNextMessage(this.ticks).then(message => {
      if (message) {
        this.run(message)
      } else {
        this._updateVmState('idle', message)
      }
    })
  }

  /**
   * run the kernels code with a given enviroment
   * The Kernel Stores all of its state in the Environment. The Interface is used
   * to by the VM to retrive infromation from the Environment.
   */
  async run (message) {
    // shallow copy
    const oldState = Object.assign({}, this._opts.state)
    let result
    try {
      result = await this.vm.run(message) || {}
    } catch (e) {
      result = {
        exception: true,
        exceptionError: e
      }
      clearObject(this._opts.state)
      Object.assign(this._opts.state, oldState)
    }

    this.emit('result', result)
    return result
  }

  // returns a promise that resolves once the kernel hits the threshould tick
  // count
  async wait (threshold) {
    return new Promise((resolve, reject) => {
      if (this.vmState === 'idle' || threshold <= this.ticks) {
        resolve(this.ticks)
      } else {
        this._waitingQueue.add({
          threshold: threshold,
          resolve: resolve
        })
      }
    })
  }

  incrementTicks (count) {
    this.ticks += count
    while (!this._waitingQueue.isEmpty()) {
      const waiter = this._waitingQueue.peek()
      if (waiter.threshold > this.ticks) {
        break
      } else {
        this._waitingQueue.poll().resolve(this.ticks)
      }
    }
  }

  async createPort (manager, type, name) {
    // incerment the nonce
    const nonce = new BN(this.state.nonce)
    nonce.iaddn(1)
    this.state.nonce = nonce.toArray()

    let portRef = this._opts.hypervisor.createPort(type, {
      nonce: this.state.nonce,
      parent: this._opts.parentPort.id
    })
    await manager.set(name, portRef)
    return portRef
  }

  getPort (manager, name) {
    return manager.getRef(name)
  }

  async send (portRef, message) {
    message._ticks = this.ticks
    const portInstance = await this.ports.get(portRef)
    portInstance.hasSent = true
    return this._opts.hypervisor.send(portRef, message)
  }
}

function clearObject (myObject) {
  for (var member in myObject) {
    delete myObject[member]
  }
}
