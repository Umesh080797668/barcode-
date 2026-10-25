import { IsString, IsNumber, IsArray, IsOptional, ValidateNested, Min, IsIn } from 'class-validator';
import { Type } from 'class-transformer';

export class InvoiceItemDto {
  @IsOptional() @IsString() barcode?: string;
  @IsString() name: string;
  @IsNumber() @Min(0) price: number;
  @IsNumber() @Min(1) quantity: number;
  @IsOptional() @IsNumber() @Min(0) discount?: number;
  @IsOptional() @IsString() warranty?: string;
  @IsOptional() @IsString() remaining_warranty?: string;
}

export class CreateInvoiceDto {
  @IsOptional() @IsString() customer_name?: string;
  @IsOptional() @IsString() customer_phone?: string;
  /** Set server-side from JWT — client value is ignored */
  @IsOptional() @IsString() cashier?: string;
  @IsNumber() @Min(0) paid_cash: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => InvoiceItemDto) items: InvoiceItemDto[];
  /**
   * sale | customer_return | supplier_return | used_purchase
   * Default: 'sale'
   */
  @IsOptional() @IsString() @IsIn(['sale', 'customer_return', 'supplier_return', 'used_purchase'])
  transaction_type?: string;
  @IsOptional() @IsString() return_reason?: string;
}
