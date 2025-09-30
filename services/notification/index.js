import amqp from 'amqplib';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EMAILS_DIR = path.join(__dirname, '../../data/emails');
const RABBITMQ_URL = process.env.RABBITMQ_URL || 'amqp://localhost';

async function sendEmail(order) {
  await fs.mkdir(EMAILS_DIR, { recursive: true });

  const itemsList = order.items.map(item => `- ${item.item} x ${item.quantity}`).join('\n');

  const email = `To: ${order.customerName}
Subject: Order Confirmation

Dear ${order.customerName},

Thank you for your order!

Ordered Items:
${itemsList}

Order Date: ${order.timestamp}

Your order will be processed shortly.

Best regards,
Clothing Shop Team`;

  const filename = `${Date.now()}_${order.customerName}.txt`;
  await fs.writeFile(path.join(EMAILS_DIR, filename), email);

  const itemsSummary = order.items.map(i => `${i.item} x ${i.quantity}`).join(', ');
  console.log(`Email sent to ${order.customerName}: ${itemsSummary}`);
}

async function start() {
  const connection = await amqp.connect(RABBITMQ_URL);
  const channel = await connection.createChannel();

  await channel.assertExchange('orders', 'fanout', { durable: false });
  const queue = await channel.assertQueue('notification_orders');
  await channel.bindQueue(queue.queue, 'orders', '');

  console.log('Notification service started');

  channel.consume(queue.queue, async (msg) => {
    const order = JSON.parse(msg.content.toString());
    await sendEmail(order);
    channel.ack(msg);
  });
}

start().catch(console.error);