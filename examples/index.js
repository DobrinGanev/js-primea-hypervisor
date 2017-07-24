const IPFS = require('ipfs')
const Hypervisor = require('../')
const AbstractContainer = require('primea-abstract-container')

// the hypervisor store all of it's state using ipfs.dag api
// https://github.com/ipfs/interface-ipfs-core/tree/master/API/dag
const node = new IPFS({
  start: false
})

// the Hypervisor starts an manages "containers"
class ExampleContainer extends AbstractContainer {
  // this method runs once when the container is intailly created. It is given
  // a message with a single port, which is a channel to its parent with the
  // exception of the root container (the container that is intailial created)
  async initialize (message) {
    const port = message.ports[0]
    // the root container doesn't get a port
    if (port) {
      this.kernel.ports.bind('parent', port)
    } else {
      super.intialize(message)
    }
  }

  // the function is called for each message that a container gets
  async run (message) {
    if (message.data === 'bindPort') {
      this.kernel.ports.bind('channel', message.ports[0])
    } else {
      super.run(message)
    }
  }
}

// wait untill the ipfs node is ready
node.on('ready', async() => {
  // create a new hypervisor instance
  const hypervisor = new Hypervisor(node.dag)
  hypervisor.registerContainer('example', ExampleContainer)

  // create a root instance of the example container
  const root = await hypervisor.createInstance('example')

  // create two channels
  const [portRef1, portRef2] = root.ports.createChannel()
  const [portRef3, portRef4] = root.ports.createChannel()

  // create two instances of the example container. These containers wiil be
  // given channels to the parent container
  root.createInstance('example', root.createMessage({
    ports: [portRef2]
  }))

  root.createInstance('example', root.createMessage({
    ports: [portRef4]
  }))

  // bind the ports of the channels to the newly created containers. Binding
  // ports allows the root container tt receieve messages from the containers.
  // If no other container bound these ports then the corrisponding containers
  // would be garbage collected
  root.ports.bind('one', portRef1)
  root.ports.bind('two', portRef3)

  // create a new channel. Each channel has two corrisponding ports that
  // containers can communicate over
  const [chanRef1, chanRef2] = root.ports.createChannel()

  // send the newly created ports to each of the containers. Once both the
  // recieving containers bind the ports they will be able to communicate
  // directly with each other over them
  await root.send(portRef1, root.createMessage({
    data: 'bindPort',
    ports: [chanRef1]
  }))

  await root.send(portRef3, root.createMessage({
    data: 'bindPort',
    ports: [chanRef2]
  }))

  // after the recieving containers bind the ports in the messages the channel
  // topology will look like this. Where "[]" are the containers, "*" are the
  // ports that the container have and "(name)" is the port name.
  //
  //        root container
  //            [ ]
  //      (one) * * (two)
  //           /    \
  //          /      \
  //         /        \
  // (parent)*          * (parent)
  //       [ ]*--------*[ ]
  //     (channel)    (channel)

  // create a new state root. The state root is not created untill the
  // hypervisor has finished all of it's work
  const stateRoot = await hypervisor.createStateRoot()
  console.log(stateRoot)
  console.log('--------full state dump---------')
  await hypervisor.graph.tree(stateRoot, Infinity)
  console.log(JSON.stringify(stateRoot, null, 2))
})
