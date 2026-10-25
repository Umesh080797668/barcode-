import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import {
  SupplierReturnsService,
  CreateSupplierReturnDto,
  ReceiveReplacementDto,
} from './supplier-returns.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('supplier-returns')
export class SupplierReturnsController {
  constructor(private readonly service: SupplierReturnsService) {}

  @Get()
  findAll(@Query('limit') limit?: string) {
    return this.service.findAll(limit ? +limit : 100);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSupplierReturnDto) {
    return this.service.create(dto);
  }

  /**
   * PATCH /supplier-returns/:id/receive
   * Body (optional, required for pending_replacement):
   *   { replacement_barcode, replacement_name, replacement_modal, replacement_qty }
   */
  @Patch(':id/receive')
  receiveReplacement(@Param('id') id: string, @Body() dto?: ReceiveReplacementDto) {
    return this.service.receiveReplacement(id, dto);
  }

  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
