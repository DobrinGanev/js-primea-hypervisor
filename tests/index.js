const tape = require('tape')
const IPFS = require('ipfs')
const Hypervisor = require('../')

// start ipfs
const node = new IPFS({
  start: false
})

class BaseContainer {
  constructor (exInterface) {
    this.exInterface = exInterface
  }

  initailize (message) {
    const port = message.ports[0]
    if (port) {
      this.exInterface.ports.bind('root', port)
    }
  }
}

node.on('ready', () => {
  tape('basic', async t => {
    t.plan(2)
    let message
    const expectedState = {
      '/': 'zdpuAyGKaZ3nbBQdgESbEgVYr81TcAFB6LE2MQQPWLZaYxuF3'
    }

    class testVMContainer extends BaseContainer {
      run (m) {
        t.true(m === message, 'should recive a message')
      }
    }

    const hypervisor = new Hypervisor(node.dag)
    hypervisor.registerContainer('test', testVMContainer)

    const rootContainer = await hypervisor.createInstance('test')
    const port = rootContainer.ports.create('test')
    message = rootContainer.createMessage()
    rootContainer.ports.bind('first', port)
    rootContainer.send(port, message)

    const stateRoot = await hypervisor.createStateRoot(Infinity)
    t.deepEquals(stateRoot, expectedState, 'expected root!')
  })

  tape('one child contract', async t => {
    t.plan(4)
    let message
    const expectedState = {
      '/': 'zdpuAtVcH6MUnvt2RXnLsDXyLB3CBSQ7aydfh2ogSKGCejJCQ'
    }
    let hasResolved = false

    class testVMContainer2 extends BaseContainer {
      run (m) {
        t.true(m === message, 'should recive a message')
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this.exInterface.incrementTicks(1)
            hasResolved = true
            resolve()
          }, 200)
        })
      }
    }

    class testVMContainer extends BaseContainer {
      run (m) {
        const port = this.exInterface.ports.create('test2')
        this.exInterface.ports.bind('child', port)
        this.exInterface.send(port, m)
        this.exInterface.incrementTicks(1)
      }
    }

    const hypervisor = new Hypervisor(node.dag)
    hypervisor.registerContainer('test', testVMContainer)
    hypervisor.registerContainer('test2', testVMContainer2)

    let root = await hypervisor.createInstance('test')
    const rootId = root.id
    let port = root.ports.create('test')

    root.ports.bind('first', port)
    message = root.createMessage()

    root.send(port, message)
    const stateRoot = await hypervisor.createStateRoot(Infinity)
    t.true(hasResolved, 'should resolve before generating the state root')
    t.deepEquals(stateRoot, expectedState, 'expected state')
    // await hypervisor.graph.tree(hypervisor._state, Infinity)
    // console.log(JSON.stringify(hypervisor._state, null, 2))
    // test reviving the state
    class testVMContainer3 extends BaseContainer {
      run (m) {
        const port = this.exInterface.ports.get('child')
        this.exInterface.send(port, m)
        this.exInterface.incrementTicks(1)
      }
    }

    hypervisor.registerContainer('test', testVMContainer3)
    root = await hypervisor.getInstance(rootId)
    port = root.ports.get('first')
    root.send(port, message)
  })

  tape.skip('ping pong', async t => {
    class Ping extends BaseContainer {
      async run (m) {
        let port = this.exInterface.ports.get('child')
        if (!port) {
          port = this.exInterface.ports.create('pong')
          this.exInterface.ports.bind(port, 'child')
        }

        if (this.exInterface.ticks < 100) {
          this.exInterface.incrementTicks(1)
          return this.exInterface.send(port, this.exInterface.createMessage())
        }
      }
    }

    class Pong extends BaseContainer {
      run (m) {
        const port = m.fromPort
        this.exInterface.incrementTicks(2)
        return this.exInterface.send(port, this.exInterface.createMessage())
      }
    }

    const hypervisor = new Hypervisor(node.dag)

    hypervisor.registerContainer('ping', Ping)
    hypervisor.registerContainer('pong', Pong)
    const root = await hypervisor.createInstance('pong')
    const port = root.ports.create('ping')
    root.ports.bind(port, 'child')

    await root.send(port, root.createMessage())
    await hypervisor.createStateRoot(root, Infinity)

    t.end()
  })

  tape('traps', async t => {
    t.plan(1)
    class Root extends BaseContainer {
      async run (m) {
        const one = this.exInterface.ports.create('root')
        const two = this.exInterface.ports.create('root')
        const three = this.exInterface.ports.create('root')

        this.exInterface.ports.bind('one', one)
        this.exInterface.ports.bind('two', two)
        this.exInterface.ports.bind('three', three)

        throw new Error('it is a trap!!!')
      }
    }

    const hypervisor = new Hypervisor(node.dag)

    hypervisor.registerContainer('root', Root)
    const root = await hypervisor.createInstance('root')
    await root.run(root.createMessage())
    // console.log('here', hypervisor.scheduler)
    const stateRoot = await hypervisor.createStateRoot()

    t.deepEquals(stateRoot, {
      '/': 'zdpuAwrMmQXqFusve7zcRYxVUuji4NVzZR5GyjwyStsjteCoW'
    }, 'should revert the state')
  })

  tape('message should arrive in the correct oder if sent in order', async t => {
    t.plan(2)
    let runs = 0

    class Root extends BaseContainer {
      run (m) {
        if (!runs) {
          runs++
          const one = this.exInterface.ports.create('first')
          const two = this.exInterface.ports.create('second')

          this.exInterface.ports.bind('one', one)
          this.exInterface.ports.bind('two', two)

          this.exInterface.send(one, this.exInterface.createMessage())
          this.exInterface.send(two, this.exInterface.createMessage())

        } else if (runs === 1) {
          runs++
          t.equals(m.data, 'second', 'should recived the second message')
        } else if (runs === 2) {
          t.equals(m.data, 'first', 'should recive the first message')
        }
      }
    }

    class First extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(2)
        this.exInterface.send(m.fromPort, this.exInterface.createMessage({data: 'first'}))
      }
    }

    class Second extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(1)
        this.exInterface.send(m.fromPort, this.exInterface.createMessage({data: 'second'}))
      }
    }

    const hypervisor = new Hypervisor(node.dag)

    hypervisor.registerContainer('root', Root)
    hypervisor.registerContainer('first', First)
    hypervisor.registerContainer('second', Second)

    const root = await hypervisor.createInstance('root')
    const port = root.ports.create('root')
    root.ports.bind('first', port)

    root.send(port, root.createMessage())
  })

  tape('message should arrive in the correct oder if sent in order', async t => {
    t.plan(2)
    let runs = 0

    class Root extends BaseContainer {
      run (m) {
        if (!runs) {
          runs++
          const one = this.exInterface.ports.create('first')
          const two = this.exInterface.ports.create('second')

          this.exInterface.ports.bind('one', one)
          this.exInterface.ports.bind('two', two)

          this.exInterface.send(one, this.exInterface.createMessage())
          this.exInterface.send(two, this.exInterface.createMessage())

          this.exInterface.incrementTicks(6)
        } else if (runs === 1) {
          runs++
          t.equals(m.data, 'first', 'should recive the first message')
        } else if (runs === 2) {
          t.equals(m.data, 'second', 'should recived the second message')
        }
      }
    }

    class First extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(1)
        this.exInterface.send(m.fromPort, this.exInterface.createMessage({data: 'first'}))
      }
    }

    class Second extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(2)
        this.exInterface.send(m.fromPort, this.exInterface.createMessage({data: 'second'}))
      }
    }

    const hypervisor = new Hypervisor(node.dag)

    hypervisor.registerContainer('root', Root)
    hypervisor.registerContainer('first', First)
    hypervisor.registerContainer('second', Second)

    const root = await hypervisor.createInstance('root')
    const port = root.ports.create('root')
    root.ports.bind('first', port)

    root.send(port, root.createMessage())
  })

  tape('message should arrive in the correct order, even in a tie of ticks', async t => {
    t.plan(2)

    let runs = 0

    class Root extends BaseContainer {
      run (m) {
        if (!runs) {
          runs++
          const one = this.exInterface.ports.create('first')
          const two = this.exInterface.ports.create('second')

          this.exInterface.ports.bind('two', two)
          this.exInterface.ports.bind('one', one)

          this.exInterface.send(one, this.exInterface.createMessage())
          this.exInterface.send(two, this.exInterface.createMessage())

          this.exInterface.incrementTicks(6)
        } else if (runs === 1) {
          runs++
          t.equals(m.data, 'second', 'should recived the second message')
        } else if (runs === 2) {
          t.equals(m.data, 'first', 'should recive the first message')
        }
      }
    }

    class First extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(2)
        return this.exInterface.send(m.fromPort, this.exInterface.createMessage({
          data: 'first'
        }))
      }
    }

    class Second extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(2)
        return this.exInterface.send(m.fromPort, this.exInterface.createMessage({
          data: 'second'
        }))
      }
    }

    const hypervisor = new Hypervisor(node.dag)

    hypervisor.registerContainer('root', Root)
    hypervisor.registerContainer('first', First)
    hypervisor.registerContainer('second', Second)

    const root = await hypervisor.createInstance('root')

    const port = root.ports.create('root')
    root.ports.bind('first', port)

    root.send(port, root.createMessage())
  })

  tape('message should arrive in the correct order, with a tie in ticks but with differnt proity', async t => {
    t.plan(2)

    let runs = 0

    class Root extends BaseContainer {
      run (m) {
        if (!runs) {
          runs++
          const one = this.exInterface.ports.create('first')
          const two = this.exInterface.ports.create('second')

          this.exInterface.ports.bind('one', one)
          this.exInterface.ports.bind('two', two)

          this.exInterface.send(two, this.exInterface.createMessage())
          this.exInterface.send(one, this.exInterface.createMessage())

          this.exInterface.incrementTicks(6)
        } else if (runs === 1) {
          runs++
          t.equals(m.data, 'first', 'should recive the first message')
        } else if (runs === 2) {
          t.equals(m.data, 'second', 'should recived the second message')
        }
      }
    }

    class First extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(2)
        return this.exInterface.send(m.fromPort, this.exInterface.createMessage({
          resources: {
            priority: 100
          },
          data: 'first'
        }))
      }
    }

    class Second extends BaseContainer {
      run (m) {
        this.exInterface.incrementTicks(2)
        return this.exInterface.send(m.fromPort, this.exInterface.createMessage({
          data: 'second'
        }))
      }
    }

    const hypervisor = new Hypervisor(node.dag)

    hypervisor.registerContainer('root', Root)
    hypervisor.registerContainer('first', First)
    hypervisor.registerContainer('second', Second)

    const root = await hypervisor.createInstance('root')
    const port = root.ports.create('root')
    root.ports.bind('first', port)
    root.send(port, root.createMessage())
  })

  tape('checking ports', async t => {
    t.plan(4)
    const hypervisor = new Hypervisor(node.dag)
    hypervisor.registerContainer('base', BaseContainer)

    const root = await hypervisor.createInstance('base')
    let port = root.ports.create('base')
    await root.ports.bind('test', port)

    try {
      root.createMessage({
        ports: [port]
      })
    } catch (e) {
      t.pass('should thow if sending a port that is bound')
    }

    try {
      await root.ports.bind('test', port)
    } catch (e) {
      t.pass('should thow if binding an already bound port')
    }

    try {
      let port2 = root.ports.create('base')
      await root.ports.bind('test', port2)
    } catch (e) {
      t.pass('should thow if binding an already bound name')
    }

    await root.ports.unbind('test')
    const message = root.createMessage({ports: [port]})
    t.equals(message.ports[0], port, 'should create a message if the port is unbound')
  })
})
