const Message = require('primea-message')
const CapsManager = require('./capsManager.js')
const Inbox = require('./inbox.js')

module.exports = class Actor {
  /**
   * the Kernel manages the varous message passing functions and provides
   * an interface for the containers to use
   * @param {Object} opts
   * @param {Object} opts.id - the UUID of the Kernel
   * @param {Object} opts.state - the state of the container
   * @param {Object} opts.hypervisor - the instance of the hypervisor
   * @param {Object} opts.container - the container constuctor and argments
   */
  constructor (opts) {
    this.state = opts.state.value
    this.code = opts.state.value.code
    this.treeNode = opts.state.node
    this.hypervisor = opts.hypervisor
    this.id = opts.id
    this.container = new opts.container.Constructor(this, opts.container.args)
    this.inbox = new Inbox({
      actor: this,
      hypervisor: opts.hypervisor
    })

    this.ticks = 0
    this.containerState = 'idle'

    this.caps = new CapsManager(opts.state.caps)
  }

  /**
   * Mints a new capabilitly with a given tag
   * @param {*} tag - a tag which can be used to identify caps
   * @return {Object}
   */
  mintCap (tag = 0) {
    return {
      destId: this.id,
      tag: tag
    }
  }

  /**
   * adds a message to this containers message queue
   * @param {string} portName
   * @param {object} message
   */
  queue (message) {
    this.inbox.queue(message)
    this._startMessageLoop()
  }

  /**
   * runs the creation routine for the actor
   * @param {object} message
   * @returns {Promise}
   */
  async create (message) {
    await this.message(message, 'onCreation')
    this._startMessageLoop()
  }

  // waits for the next message
  async _startMessageLoop () {
    // this ensure we only every have one loop running at a time
    if (this.containerState !== 'running') {
      this.containerState = 'running'
      while (1) {
        const message = await this.inbox.getNextMessage()
        if (!message) break

        // if the message we recived had more ticks then we currently have then
        // update it
        if (message._fromTicks > this.ticks) {
          this.ticks = message._fromTicks
          this.hypervisor.scheduler.update(this)
        }
        // run the next message
        await this.message(message)
      }

      this.containerState = 'idle'
      this.container.onIdle()
    }
  }

  /**
   * Runs the shutdown routine for the actor
   */
  shutdown () {
    this.hypervisor.scheduler.done(this.id)
  }

  /**
   * Runs the startup routine for the actor
   */
  startup () {
    return this.container.onStartup()
  }

  /**
   * run the Actor with a given message
   * @param {object} message - the message to run
   * @param {String} method - which method to run
   * @returns {Promise}
   */
  async message (message, method = 'onMessage') {
    const responseCap = message.responseCap
    delete message.responseCap

    let result
    try {
      result = await this.container[method](message)
    } catch (e) {
      console.log(e)
      result = {
        exception: true,
        exceptionError: e
      }
    }

    if (responseCap) {
      this.send(responseCap, new Message({
        data: result
      }))
    }
    this.caps.clist.clear()
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
   * creates an actor
   * @param {Integer} type - the type id for the container
   * @param {Object} message - an intial [message](https://github.com/primea/js-primea-message) to send newly created actor
   */
  createActor (type, message) {
    const id = this._generateNextId()
    return this.hypervisor.createActor(type, message, id)
  }

  _generateNextId () {
    const id = {
      nonce: this.state.nonce,
      parent: this.id
    }

    this.state.nonce++
    return id
  }

  /**
   * sends a message to a given port
   * @param {Object} portRef - the port
   * @param {Message} message - the message
   */
  send (cap, message) {
    message._fromTicks = this.ticks
    message._fromId = this.id
    message.tag = cap.tag

    return this.hypervisor.send(cap, message)
  }
}
