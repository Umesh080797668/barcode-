import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Server } from 'socket.io';

@WebSocketGateway({ cors: { origin: process.env.FRONTEND_URL || '*' } })
export class EventsGateway {
  @WebSocketServer() server: Server;

  broadcastStockUpdate(barcode: string, newQuantity: number) {
    this.server.emit('stock:updated', { barcode, quantity: newQuantity });
  }

  broadcastNewInvoice(invoice: any) {
    this.server.emit('invoice:created', invoice);
  }
}
