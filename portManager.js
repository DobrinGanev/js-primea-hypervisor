const DeleteMessage = require('./deleteMessage')


module.exports = class PortManager {
  /**
   * The port manager manages the the ports. This inculdes creation, deletion
   * fetching and waiting on ports
   * @param {Object} opts
   * @param {Object} opts.state
   * @param {Object} opts.hypervisor
   * @param {Object} opts.exoInterface
   */
  constructor (opts) {
    Object.assign(this, opts)
    this.ports = this.state.ports

    this._waitingPorts = {}
    // tracks unbounded ports that we have
    this._unboundPorts = new Set()
    this._saturationPromise = new Promise((resolve, reject) => {
      this._saturationResolve = resolve
    })
    this._oldestMessagePromise = new Promise((resolve, reject) => {
      this._oldestMessageResolve = resolve
    })
  }

  /**
   * binds a port to a name
   * @param {Object} port - the port to bind
   * @param {String} name - the name of the port
   */
  async bind (name, port) {
    if (this.isBound(port)) {
      throw new Error('cannot bind a port that is already bound')
    } else if (this.ports[name]) {
      throw new Error('cannot bind port to a name that is alread bound')
    } else {
      this._unboundPorts.delete(port)

      // save the port instance
      this.ports[name] = port

      // update the dest port
      const destPort = await this.hypervisor.getDestPort(port)
      port.messages.forEach(message => {
        message._fromPort = port
        message.fromName = name
      })

      if (destPort) {
        destPort.destName = name
        destPort.destId = this.id
        delete destPort.destPort
      }
    }
  }

  /**
   * unbinds a port given its name
   * @param {string} name
   * @returns {Promise}
   */
  async unbind (name) {
    const port = this.ports[name]
    delete this.ports[name]
    this._unboundPorts.add(port)
    this.hypervisor.addNodeToCheck(this.id)

    // update the destination port
    const destPort = await this.hypervisor.getDestPort(port)
    delete destPort.destName
    delete destPort.destId
    destPort.destPort = port

    return port
  }

  /**
   * delete an port given the name it is bound to
   * @param {string} name
   */
  async delete (name) {
    const port = this.ports[name]
    await this.kernel.send(port, new DeleteMessage())
    this._delete(name)
  }

  _delete (name) {
    this.hypervisor.addNodeToCheck(this.id)
    delete this.ports[name]
  }

  /**
   * clears any unbounded ports referances
   */
  clearUnboundedPorts () {
    const waits = []
    this._unboundPorts.forEach(port => {
      waits.push(this.kernel.send(port, new DeleteMessage()))
    })

    this._unboundPorts.clear()
    return Promise.all(waits)
  }

  /**
   * check if a port object is still valid
   * @param {Object} port
   * @return {Boolean}
   */
  isBound (port) {
    return !this._unboundPorts.has(port)
  }

  /**
   * queues a message on a port
   * @param {Message} message
   */
  queue (name, message) {
    const port = this.ports[name]

    message._fromPort = port
    message.fromName = name

    const numOfMsg = port.messages.push(message)

    if (numOfMsg === 1) {
      if (isSaturated(this._waitingPorts)) {
        this._saturationResolve()
        this._saturationPromise = new Promise((resolve, reject) => {
          this._saturationResolve = resolve
        })
      } else if (message._fromTicks < this._messageTickThreshold) {
        this._oldestMessageResolve(message)
        this._oldestMessagePromise = new Promise((resolve, reject) => {
          this._oldestMessageResolve = resolve
        })
        this._messageTickThreshold = Infinity
      }
    }
  }

  /**
   * gets a port given it's name
   * @param {String} name
   * @return {Object}
   */
  get (name) {
    return this.ports[name]
  }

  /**
   * creates a channel returns the created ports in an Array
   * @returns {array}
   */
  createChannel () {
    const [port1, port2] = this.hypervisor.createChannel()
    this._unboundPorts.add(port1)
    this._unboundPorts.add(port2)
    return [port1, port2]
  }

  /**
   * Waits for the the next message if any
   * @returns {Promise}
   */
  async getNextMessage (ports = this.ports, timeout = Infinity) {
    let message = peekNextMessage(ports)
    let oldestTime = this.hypervisor.scheduler.leastNumberOfTicks()
    let saturated = false

    if (Object.keys(this._waitingPorts).length) {
      throw new Error('already getting next message')
    }

    this._waitingPorts = ports

    const findOldestMessage = async () => {
      while (// end if we have a message older then slowest containers
        !((message && oldestTime >= message._fromTicks) ||
          // end if there are no messages and this container is the oldest contaner
          (!message && oldestTime === this.kernel.ticks))) {
        if (saturated) {
          break
        }
        let ticksToWait = message ? message._fromTicks : this.kernel.ticks
        // ticksToWait = ticksToWait > timeout ? timeout : ticksToWait
        await Promise.race([
          this.hypervisor.scheduler.wait(ticksToWait, this.id).then(() => {
            message = peekNextMessage(ports)
          }),
          this._olderMessage(message).then(m => {
            message = m
          })
        ])
        oldestTime = this.hypervisor.scheduler.leastNumberOfTicks()
      }
    }

    await Promise.race([
      this._whenSaturated(ports).then(() => {
        message = peekNextMessage(ports)
        saturated = true
      }),
      findOldestMessage()
    ])

    this._waitingPorts = {}

    return message
  }

  // returns a promise that resolve when the ports are saturated
  _whenSaturated (ports) {
    if (isSaturated(ports)) {
      return Promise.resolve()
    } else {
      return this._saturationPromise
    }
  }

  // returns a promise that resolve when a message older then the given message
  // is recived
  _olderMessage (message) {
    this._messageTickThreshold = message ? message._fromTicks : -1
    return this._oldestMessagePromise
  }

  removeSentPorts (message) {
    message.ports.forEach(port => this._unboundPorts.delete(port))
  }

  addReceivedPorts (message) {
    message.ports.forEach(port => this._unboundPorts.add(port))
  }

  checkSendingPorts (message) {
    for (const port of message.ports) {
      if (this.isBound(port)) {
        throw new Error('message must not contain bound ports')
      }
    }
  }
}

// tests wether or not all the ports have a message
function isSaturated (ports) {
  const values = Object.values(ports)
  return values.length ? values.every(port => port.messages.length) : true
}

// find and returns the next message that this instance currently knows about
function peekNextMessage (ports) {
  ports = Object.values(ports)
  if (ports.length) {
    const port = ports.reduce(messageArbiter)
    return port.messages[0]
  }
}

// decides which message to go first
function messageArbiter (portA, portB) {
  const a = portA.messages[0]
  const b = portB.messages[0]

  if (!a) {
    return portB
  } else if (!b) {
    return portA
  }

  // order by number of ticks if messages have different number of ticks
  if (a._fromTicks !== b._fromTicks) {
    return a._fromTicks < b._fromTicks ? portA : portB
  } else {
    // insertion order
    return portA
  }
}
