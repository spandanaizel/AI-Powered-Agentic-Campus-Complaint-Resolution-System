import bcrypt from 'bcryptjs';
import { User } from '../models/index.js';
import { issueSession, clearSession } from '../middleware/auth.js';
import { audit } from '../services/auditService.js';
import { unauthorized, conflict } from '../utils/errors.js';

const BCRYPT_ROUNDS = 12;
// Compared against when the email is unknown so response timing does not reveal account existence.
const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-password', BCRYPT_ROUNDS);
export const hashPassword = (p) => bcrypt.hash(p, BCRYPT_ROUNDS);

const publicUser = (u) => ({ id: u._id, name: u.name, email: u.email, role: u.role });

export async function register(req, res) {
  const { name, email, password } = req.body;
  if (await User.exists({ email })) throw conflict('An account with this email already exists. Try signing in.');
  // Self-registration always creates a student. The role is never taken from the request.
  const user = await User.create({ name, email, passwordHash: await hashPassword(password), role: 'student' });
  await audit({ actor: user, action: 'user.registered', resourceType: 'User', resourceId: user._id });
  issueSession(res, user);
  res.status(201).json({ user: publicUser(user) });
}

export async function login(req, res) {
  const { email, password } = req.body;
  const user = await User.findOne({ email }).select('+passwordHash');
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  // Generic message for unknown email, wrong password and deactivated account alike.
  if (!user || !ok || !user.active) throw unauthorized('Invalid email or password');
  issueSession(res, user);
  res.json({ user: publicUser(user) });
}

export async function logout(req, res) {
  // Invalidate every outstanding token for this account, then clear the cookie.
  await User.updateOne({ _id: req.user._id }, { $inc: { tokenVersion: 1 } });
  clearSession(res);
  res.status(204).end();
}

export function me(req, res) {
  res.json({ user: publicUser(req.user) });
}
