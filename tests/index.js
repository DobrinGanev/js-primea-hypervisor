const tape = require('tape')
const IPFS = require('ipfs')
const Hypervisor = require('../')
const Message = require('primea-message')

const node = new IPFS()

class BaseContainer {
  constructor (kernel) {
    this.kernel = kernel
  }

  static createState (code) {
    return {
      nonce: [0],
      ports: {}
    }
  }
}

node.on('error', err => {
  console.log(err)
})

node.on('start', () => {
  tape('basic', async t => {
    const message = new Message()
    const expectedState = {
      '/': 'zdpuAntkdU7yBJojcBT5Q9wBhrK56NmLnwpHPKaEGMFnAXpv7'
    }

    class testVMContainer extends BaseContainer {
      run (m) {
        t.true(m === message, 'should recive a message')
      }
    }

    const hypervisor = new Hypervisor({dag: node.dag})
    hypervisor.registerContainer('test', testVMContainer)

    const rootContainer = await hypervisor.createInstance('test')
    const port = await rootContainer.createPort('test', 'first')

    await rootContainer.send(port, message)

    const stateRoot = await hypervisor.createStateRoot(rootContainer, Infinity)
    t.deepEquals(stateRoot, expectedState, 'expected root!')
    t.end()
  })

  tape('one child contract', async t => {
    let message = new Message()
    const expectedState = {
      '/': 'zdpuAofSzrBqwYs6z1r28fMeb8z5oSKF6CcWA6m22RqazgoTB'
    }
    let hasResolved = false

    class testVMContainer2 extends BaseContainer {
      run (m) {
        t.true(m === message, 'should recive a message 2')
        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this.kernel.incrementTicks(1)
            hasResolved = true
            resolve()
          }, 200)
        })
      }
    }

    class testVMContainer extends BaseContainer {
      async run (m) {
        const port = await this.kernel.createPort('test2', 'child')
        await this.kernel.send(port, m)
        this.kernel.incrementTicks(1)
      }
    }

    const hypervisor = new Hypervisor({dag: node.dag})
    hypervisor.registerContainer('test', testVMContainer)
    hypervisor.registerContainer('test2', testVMContainer2)

    let root = await hypervisor.createInstance('test')
    let port = await root.createPort('test', 'first')

    await root.send(port, message)
    const stateRoot = await hypervisor.createStateRoot(root, Infinity)
    t.true(hasResolved, 'should resolve before generating the state root')
    t.deepEquals(stateRoot, expectedState, 'expected state')

    // test reviving the state
    class testVMContainer3 extends BaseContainer {
      async run (m) {
        const port = this.kernel.ports.get('child')
        await this.kernel.send(port, m)
        this.kernel.incrementTicks(1)
      }
    }

    hypervisor.registerContainer('test', testVMContainer3)
    root = await hypervisor.createInstance('test', stateRoot)
    port = await root.ports.get('first')

    await root.send(port, message)
    await hypervisor.createStateRoot(root, Infinity)

    t.end()
  })

  tape('ping pong', async t => {
    class Ping extends BaseContainer {
      async run (m) {
        let port = this.kernel.ports.get('child')
        if (!port) {
          port = await this.kernel.createPort('pong', 'child')
        }

        if (this.kernel.ticks < 100) {
          this.kernel.incrementTicks(1)
          return this.kernel.send(port, new Message())
        }
      }
    }

    class Pong extends BaseContainer {
      run (m) {
        const port = m.fromPort
        return this.kernel.send(port, new Message())
      }
    }

    const hypervisor = new Hypervisor({
      dag: node.dag
    })

    hypervisor.registerContainer('ping', Ping)
    hypervisor.registerContainer('pong', Pong)
    const root = await hypervisor.createInstance('pong')
    const port = await root.createPort('ping', 'child')

    await root.send(port, new Message())
    await hypervisor.createStateRoot(root, Infinity)

    t.end()
  })

  tape('queing multiple messages', async t => {
    let runs = 0

    class Root extends BaseContainer {
      async run (m) {
        const one = this.kernel.createPort('child', 'one')
        const two = this.kernel.createPort('child', 'two')
        const three = this.kernel.createPort('child', 'three')

        await Promise.all([
          this.kernel.send(one, new Message()),
          this.kernel.send(two, new Message()),
          this.kernel.send(three, new Message())
        ])

        return new Promise((resolve, reject) => {
          setTimeout(() => {
            this.kernel.incrementTicks(2)
            resolve()
          }, 200)
        })
      }
    }

    class Child extends BaseContainer {
      run (m) {
        runs++
        this.kernel.incrementTicks(2)
      }
    }

    const hypervisor = new Hypervisor({
      dag: node.dag
    })

    hypervisor.registerContainer('root', Root)
    hypervisor.registerContainer('child', Child)

    const root = await hypervisor.createInstance('root')
    const port = await root.createPort('root', 'first')
    await root.send(port, new Message())
    await root.wait(Infinity)

    t.equals(runs, 3, 'the number of run should be 3')
    const nonce = await hypervisor.graph.get(root.state, 'ports/first/link/nonce/0')
    t.equals(nonce, 3, 'should have the correct nonce')

    t.end()
  })

  tape('traps', async t => {
    class Root extends BaseContainer {
      async run (m) {
        await Promise.all([
          this.kernel.createPort('root', 'one'),
          this.kernel.createPort('root', 'two'),
          this.kernel.createPort('root', 'three')
        ])

        throw new Error('it is a trap!!!')
      }
    }

    const hypervisor = new Hypervisor({
      dag: node.dag
    })

    hypervisor.registerContainer('root', Root)
    const root = await hypervisor.createInstance('root')
    await root.run()

    t.deepEquals(root.state, {
      '/': {
        nonce: [0],
        ports: {}
      }
    }, 'should revert the state')

    t.end()

    node.stop(() => {
      process.exit()
    })
  })
})
