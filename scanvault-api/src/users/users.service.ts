import { Injectable, NotFoundException, ConflictException, BadRequestException } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from './user.schema';
import * as bcrypt from 'bcrypt';

export class CreateUserDto {
  username: string;
  password: string;
  display_name: string;
  role: 'owner' | 'cashier';
}

export class UpdateUserDto {
  display_name?: string;
  role?: 'owner' | 'cashier';
  active?: boolean;
}

@Injectable()
export class UsersService {
  constructor(@InjectModel(User.name) private userModel: Model<User>) {}

  async findAll() {
    return this.userModel
      .find()
      .select('-password_hash')
      .sort({ created_at: -1 })
      .exec();
  }

  async findOne(id: string) {
    const user = await this.userModel.findById(id).select('-password_hash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    if (!dto.username || !dto.password || dto.password.length < 8) {
      throw new BadRequestException('username and password (≥8 chars) are required');
    }

    const existing = await this.userModel.findOne({ username: dto.username });
    if (existing) throw new ConflictException('Username already taken');

    const password_hash = await bcrypt.hash(dto.password, 12);
    const user = await this.userModel.create({
      username: dto.username,
      password_hash,
      display_name: dto.display_name,
      role: dto.role ?? 'cashier',
    });

    // Never return the hash
    const { password_hash: _, ...safe } = user.toObject();
    return safe;
  }

  async update(id: string, dto: UpdateUserDto) {
    const user = await this.userModel
      .findByIdAndUpdate(id, { $set: dto }, { new: true })
      .select('-password_hash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Owner-triggered password reset — no email/SMS, returns temporary password */
  async resetPassword(id: string, newPassword: string) {
    if (!newPassword || newPassword.length < 8) {
      throw new BadRequestException('New password must be at least 8 characters');
    }
    const user = await this.userModel.findById(id);
    if (!user) throw new NotFoundException('User not found');

    user.password_hash = await bcrypt.hash(newPassword, 12);
    await user.save();
    return { success: true };
  }

  async deactivate(id: string) {
    const user = await this.userModel.findByIdAndUpdate(
      id,
      { $set: { active: false } },
      { new: true },
    ).select('-password_hash');
    if (!user) throw new NotFoundException('User not found');
    return user;
  }
}
