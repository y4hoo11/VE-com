// types/express.d.ts
// Express の Request に、認証ミドルウェアがセットする user を追加する
import type { Role } from '@prisma/client';

export interface AuthUser {
  id: string;
  username: string;
  role: Role;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}
