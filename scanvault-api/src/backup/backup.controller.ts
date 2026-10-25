import { Controller, Post, Get, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { BackupService } from './backup.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { RolesGuard } from '../auth/roles.guard';
import { Roles } from '../auth/roles.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('owner')
@Controller('backup')
export class BackupController {
  constructor(private readonly service: BackupService) {}

  @Post('run')
  async runBackup() {
    // Fire-and-forget — backup runs asynchronously so the response is instant
    this.service.runDailyBackup().catch(() => {/* logged inside service */});
    return { success: true, message: 'Backup started' };
  }

  @Get('export.csv')
  async exportCsv(@Res() res: Response) {
    const csv = await this.service.buildCsv();
    const filename = `oshini-store-export-${new Date().toISOString().slice(0, 10)}.csv`;
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.send(csv);
  }

  @Get('snapshot')
  async getSnapshot() {
    return this.service.buildSnapshot();
  }
}
