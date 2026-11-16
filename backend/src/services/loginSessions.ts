// services/loginSessions.ts
// 1 つのアカウントで同時にログインできるのは 1 端末だけにする（後からログインした方が有効）。
//
// ログインのたびに「ログインの番号（sid）」を作ってトークンに入れ、ユーザーごとに最新の番号だけを覚える。
// 古い番号のトークン（前の端末）は、API でも Socket.IO でも使えなくなる。
//
// 覚えておくのはサーバーのメモリだけ（DB は変えない）。サーバーを再起動すると忘れるので、
// 再起動後は「最初に届いたトークン」をそのユーザーの今のログインとして覚え直す（全員をログアウトさせないため）。
import { randomUUID } from 'node:crypto';

const current = new Map<string, string>(); // ユーザーID → いま有効なログインの番号

export const loginSessions = {
  /** ログインした：新しい番号を作り、これまでのログインを無効にする */
  start(userId: string) {
    const sid = randomUUID();
    current.set(userId, sid);
    return sid;
  },

  /** このトークンは、そのユーザーの「いまのログイン」のものか */
  isCurrent(userId: string, sid: string | undefined) {
    const cur = current.get(userId);
    if (!cur) {
      // 覚えていない（サーバーの再起動後など）：このトークンを今のログインとして覚える
      if (sid) current.set(userId, sid);
      return true;
    }
    return cur === sid;
  },
};
