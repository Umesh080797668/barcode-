import { IsString, IsNumber, IsOptional, Min } from 'class-validator';

export class CreateProductDto {
  @IsString() barcode: string;
  @IsString() name: string;
  @IsOptional() @IsString() sku?: string;
  @IsNumber() @Min(0) price: number;
  @IsNumber() @Min(0) quantity: number;
  @IsOptional() @IsString() category?: string;
  @IsOptional() custom_fields?: Record<string, any>;
}
