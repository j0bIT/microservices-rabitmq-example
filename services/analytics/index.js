import amqp from 'amqplib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ANALYTICS_FILE = path.join(__dirname, '../../data/analytics.txt');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function readAnalytics() {
  try {
    const data = await fs.readFile(ANALYTICS_FILE, 'utf-8');
    return data.trim().split('\n').reduce((acc, line) => {
      const [item, count] = line.split(':');
      acc[item] = parseInt(count);
      return acc;
    }, {});
  } catch {
    return {};
  }
}

async function writeAnalytics(analytics) {
  const data = Object.entries(analytics)
    .map(([item, count]) => `${item}:${count}`)
    .join('\n');
  await fs.writeFile(ANALYTICS_FILE, data);
}

async function trackOrder(order) {
  const analytics = await readAnalytics();

  for (const item of order.items) {
    analytics[item.item] = (analytics[item.item] || 0) + item.quantity;
    console.log(`Tracked order: ${item.item} x ${item.quantity} (Total: ${analytics[item.item]})`);
  }

  await writeAnalytics(analytics);
}

async function start() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange('orders', 'fanout', { durable: false });
  const queue = await channel.assertQueue('analytics_orders');
  await channel.bindQueue(queue.queue, 'orders', '');

  console.log('Analytics service started');

  channel.consume(queue.queue, async (msg) => {
    const order = JSON.parse(msg.content.toString());
    await trackOrder(order);
    channel.ack(msg);
  });
}

start().catch(console.error);