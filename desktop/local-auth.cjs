// Desktop authority is held in the main process, never inferred from renderer storage.
function createLocalAuth() {
  const accounts = { admin: { password: 'admin123', role: 'admin' }, user: { password: 'user123', role: 'user' } };
  let session = null;
  return {
    current: () => session ? { ...session } : null,
    login(input) {
      const username = typeof input?.username === 'string' ? input.username.trim().toLowerCase() : '';
      const account = Object.hasOwn(accounts, username) ? accounts[username] : null;
      if (!account || account.password !== input?.password) throw new Error('账号或密码错误');
      session = { username, role: account.role }; return { ...session };
    },
    logout() { session = null; },
    requireAdmin() { if (session?.role !== 'admin') throw new Error('只有已登录的本机管理员可以管理服务器'); },
  };
}
module.exports = { createLocalAuth };
