import { Controller, Get, Post, Delete, Param, Body, UseGuards } from '@nestjs/common';
import { CustomFieldsService } from './custom-fields.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('custom-fields')
export class CustomFieldsController {
  constructor(private readonly service: CustomFieldsService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Roles('owner')
  @Post()
  create(@Body() dto: any) {
    return this.service.create(dto);
  }

  @Roles('owner')
  @Delete(':id')
  delete(@Param('id') id: string) {
    return this.service.delete(id);
  }
}
