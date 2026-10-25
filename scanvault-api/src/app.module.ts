import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

import { EventsModule } from './events/events.module';
import { ProductsModule } from './products/products.module';
import { InvoicesModule } from './invoices/invoices.module';
import { SupplierReturnsModule } from './supplier-returns/supplier-returns.module';
import { CustomFieldsModule } from './custom-fields/custom-fields.module';
import { ReportsModule } from './reports/reports.module';
import { BackupModule } from './backup/backup.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    MongooseModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        uri: configService.getOrThrow<string>('MONGO_URI'),
      }),
      inject: [ConfigService],
    }),
    ScheduleModule.forRoot(),
    EventsModule,
    ProductsModule,
    InvoicesModule,
    SupplierReturnsModule,
    CustomFieldsModule,
    ReportsModule,
    BackupModule,
    AuthModule,
    UsersModule,
  ],
})
export class AppModule { }
