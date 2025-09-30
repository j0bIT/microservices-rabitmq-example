import amqp from 'amqplib';
import readline from 'readline';
import { randomUUID } from 'crypto';

const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => rl.question(prompt, resolve));
}

async function queryInventory(channel) {
  const correlationId = randomUUID();
  const replyQueue = await channel.assertQueue('', { exclusive: true });

  return new Promise((resolve) => {
    channel.consume(replyQueue.queue, (msg) => {
      if (msg.properties.correlationId === correlationId) {
        resolve(JSON.parse(msg.content.toString()));
      }
    }, { noAck: true });

    channel.sendToQueue('inventory_query', Buffer.from(''), {
      correlationId,
      replyTo: replyQueue.queue
    });
  });
}

async function placeOrder(channel, items, customerName) {
  await channel.assertExchange('orders', 'fanout', { durable: false });
  const order = { items, customerName, timestamp: new Date().toISOString() };
  channel.publish('orders', '', Buffer.from(JSON.stringify(order)));
}

function parseOrderInput(input, itemsList) {
  const orders = [];
  const parts = input.split(',').map(p => p.trim());

  for (const part of parts) {
    const [indexStr, quantityStr] = part.split(':').map(s => s.trim());
    const index = parseInt(indexStr);
    const quantity = parseInt(quantityStr);

    if (isNaN(index) || isNaN(quantity) || index < 1 || index > itemsList.length || quantity < 1) {
      throw new Error(`Invalid order format: ${part}`);
    }

    orders.push({ item: itemsList[index - 1].name, quantity });
  }

  return orders;
}

function validateOrders(orders, inventory) {
  for (const order of orders) {
    if (!inventory[order.item]) {
      throw new Error(`Item not found: ${order.item}`);
    }
    if (inventory[order.item] < order.quantity) {
      throw new Error(`Not enough stock for ${order.item}. Available: ${inventory[order.item]}, Requested: ${order.quantity}`);
    }
  }
}

async function getOrderInput(itemsList, inventory) {
  while (true) {
    try {
      const input = await question('\nYour order (e.g., 1:3, 2:2): ');
      const orders = parseOrderInput(input, itemsList);
      validateOrders(orders, inventory);
      return orders;
    } catch (error) {
      console.log(`\nError: ${error.message}`);
      console.log('Please try again.\n');
    }
  }
}

async function start() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  console.log('Welcome to the Clothing Shop!\n');

  const inventory = await queryInventory(channel);
  const itemsList = Object.entries(inventory).map(([name, quantity]) => ({ name, quantity }));

  if (itemsList.length === 0 || itemsList.every(i => i.quantity === 0)) {
    console.log('Sorry, no items available at the moment.\n');
    await channel.close();
    await connection.close();
    rl.close();
    return;
  }

  console.log('Available items:');
  itemsList.forEach((item, index) => {
    console.log(`(${index + 1}) ${item.name}: ${item.quantity} available`);
  });

  const orders = await getOrderInput(itemsList, inventory);
  const customerName = await question('\nPlease enter your name: ');

  await placeOrder(channel, orders, customerName);

  console.log('\nOrder placed successfully!\n');

  await channel.close();
  await connection.close();
  rl.close();
}

start().catch(console.error);