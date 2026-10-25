import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('reports')
export class ReportsController {
  constructor(private readonly service: ReportsService) {}

  /**
   * GET /reports/data?type=daily&days=30
   * Matches the legacy electronAPI.getReportData(type) call.
   */
  @Get('data')
  getReportData(@Query('type') type = 'daily', @Query('days') days?: string) {
    if (type === 'monthly') {
      return this.service.getMonthlyReport(days ? +days : 12);
    }
    return this.service.getDailyReport(days ? +days : 30);
  }

  @Get('type/:type')
  getReportByType(@Param('type') type: string, @Query('days') days?: string) {
    if (type === 'monthly') {
      return this.service.getMonthlyReport(days ? +days : 12);
    }
    return this.service.getDailyReport(days ? +days : 30);
  }

  @Get('summary')
  getSummary(@Query('days') days?: string) {
    return this.service.getSummary(days ? +days : undefined);
  }

  @Get('top-products')
  getTopProducts(@Query('limit') limit?: string) {
    return this.service.getTopProducts(limit ? +limit : 20);
  }

  @Get('low-stock')
  getLowStock(@Query('threshold') threshold?: string) {
    return this.service.getLowStock(threshold ? +threshold : 5);
  }

  @Get('cashiers')
  getCashierStats(@Query('days') days?: string) {
    return this.service.getCashierStats(days ? +days : 30);
  }
}
