const Message = require('primea-message')
const PortManager = require('./portManager.js')
const DeleteMessage = require('./deleteMessage')

module.exports = class Kernel {
  /**
   * the ExoInterface manages the varous message passing functions and provides
   * an interface for the containers to use
   * @param {Object} opts
   * @param {Object} opts.id
   * @param {Object} opts.state
   * @param {Object} opts.hypervisor
   * @param {Object} opts.Container
   */
  constructor (opts) {
    this.state = opts.state
    this.hypervisor = opts.hypervisor
    this.id = opts.id
    this.container = new opts.container.Constructor(this, opts.container.args)

    this.ticks = 0
    this.containerState = 'idle'

    // create the port manager
    this.ports = new PortManager(Object.assign({
      kernel: this
    }, opts))
  }

  /**
   * adds a message to this containers message queue
   * @param {string} portName
   * @param {object} message
   */
  queue (portName, message) {
    message._hops++
    if (portName) {
      this.ports.queue(portName, message)
      if (this.containerState !== 'running') {
        this.containerState = 'running'
        this._runNextMessage()
      }
    } else {
      // initailiazation message
      this.containerState = 'running'
      this.run(message, true)
    }
  }

  // waits for the next message
  async _runNextMessage () {
    // check if the ports are saturated, if so we don't have to wait on the
    // scheduler
    const message = await this.ports.getNextMessage()

    if (!message) {
      // if no more messages then shut down
      this.hypervisor.scheduler.done(this.id)
    } else {
      message.fromPort.messages.shift()
      // if the message we recived had more ticks then we currently have the
      // update it
      if (message._fromTicks > this.ticks) {
        this.ticks = message._fromTicks
      }
      this.hypervisor.scheduler.update(this)
      // run the next message
      this.run(message)
    }
  }

  /**
   * run the kernels code with a given enviroment
   * The Kernel Stores all of its state in the Environment. The Interface is used
   * to by the VM to retrive infromation from the Environment.
   * @returns {Promise}
   */
  async run (message, init = false) {
    let result
    message.ports.forEach(port => this.ports._unboundPorts.add(port))
    if (message.constructor === DeleteMessage) {
      this.ports._delete(message.fromName)
    } else {
      const method = init ? 'initailize' : 'run'
      try {
        result = await this.container[method](message) || {}
      } catch (e) {
        result = {
          exception: true,
          exceptionError: e
        }
      }
    }
    this.ports.clearUnboundedPorts()
    // message.response(result)
    this._runNextMessage()
    return result
  }

  /**
   * updates the number of ticks that the container has run
   * @param {Number} count - the number of ticks to add
   */
  incrementTicks (count) {
    this.ticks += count
    this.hypervisor.scheduler.update(this)
  }

  /**
   * creates a new message
   * @param {*} data
   */
  createMessage (opts) {
    const message = new Message(opts)
    for (const port of message.ports) {
      if (this.ports.isBound(port)) {
        throw new Error('message must not contain bound ports')
      }
    }
    return message
  }

  /**
   * sends a message to a given port
   * @param {Object} portRef - the port
   * @param {Message} message - the message
   */
  async send (port, message) {
    // set the port that the message came from
    message._fromTicks = this.ticks
    message.ports.forEach(port => this.ports._unboundPorts.delete(port))

    // if (this.currentMessage !== message && !message.responsePort) {
    //   this.currentMessage._addSubMessage(message)
    // }

    if (port.destId) {
      const id = port.destId
      const instance = await this.hypervisor.getInstance(id)
      instance.queue(port.destName, message)
    } else {
      // port is unbound
      port.destPort.messages.push(message)
    }
  }
}
