import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { User } from '../users/user.schema';

@Injectable()
export class AuthService {
  constructor(
    @InjectModel(User.name) private userModel: Model<User>,
    private jwt: JwtService,
  ) {}

  async login(username: string, password: string) {
    const user = await this.userModel.findOne({ username, active: true });
    if (!user || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException('Invalid username or password');
    }
    const payload = { sub: user._id, username: user.username, role: user.role, name: user.display_name };
    return {
      access_token: this.jwt.sign(payload),
      user: { username: user.username, role: user.role, name: user.display_name },
    };
  }
}
