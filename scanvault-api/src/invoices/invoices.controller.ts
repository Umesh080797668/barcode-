import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, Req } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('invoices')
export class InvoicesController {
  constructor(private readonly service: InvoicesService) {}

  @Get()
  findAll(@Query('limit') limit?: string) {
    return this.service.findAll(limit ? +limit : undefined);
  }

  @Get('search')
  search(@Query('customer') customer: string) {
    return this.service.findByCustomer(customer);
  }

  @Get(':invoiceNo')
  findOne(@Param('invoiceNo') invoiceNo: string) {
    return this.service.findOne(invoiceNo);
  }

  @Post()
  create(@Body() dto: CreateInvoiceDto, @Req() req: any) {
    // Cashier name comes from the JWT token — never trust client-supplied value
    return this.service.create({ ...dto, cashier: req.user.name });
  }

  @Roles('owner')
  @Patch(':invoiceNo')
  update(@Param('invoiceNo') invoiceNo: string, @Body() body: any) {
    return this.service.update(invoiceNo, body);
  }

  @Roles('owner')
  @Delete(':invoiceNo')
  delete(@Param('invoiceNo') invoiceNo: string) {
    return this.service.delete(invoiceNo);
  }
}
