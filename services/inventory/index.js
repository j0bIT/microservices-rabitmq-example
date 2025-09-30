import amqp from 'amqplib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const INVENTORY_FILE = path.join(__dirname, '../../data/inventory.txt');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function readInventory() {
  const data = await fs.readFile(INVENTORY_FILE, 'utf-8');
  return data.trim().split('\n').reduce((acc, line) => {
    const [item, quantity] = line.split(':');
    acc[item] = parseInt(quantity);
    return acc;
  }, {});
}

async function writeInventory(inventory) {
  const data = Object.entries(inventory)
    .map(([item, quantity]) => `${item}:${quantity}`)
    .join('\n');
  await fs.writeFile(INVENTORY_FILE, data);
}

async function start() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertQueue('inventory_query');
  await channel.assertExchange('orders', 'fanout', { durable: false });
  await channel.assertQueue('inventory_orders');
  await channel.bindQueue('inventory_orders', 'orders', '');

  console.log('Inventory service started');

  channel.consume('inventory_query', async (msg) => {
    const inventory = await readInventory();
    channel.sendToQueue(
      msg.properties.replyTo,
      Buffer.from(JSON.stringify(inventory)),
      { correlationId: msg.properties.correlationId }
    );
    channel.ack(msg);
  });

  channel.consume('inventory_orders', async (msg) => {
    const order = JSON.parse(msg.content.toString());
    const inventory = await readInventory();

    for (const item of order.items) {
      if (inventory[item.item] >= item.quantity) {
        inventory[item.item] -= item.quantity;
        console.log(`Updated inventory: ${item.item} (${inventory[item.item]} left)`);
      }
    }

    await writeInventory(inventory);
    channel.ack(msg);
  });
}

start().catch(console.error);