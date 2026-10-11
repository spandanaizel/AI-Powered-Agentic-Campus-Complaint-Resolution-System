import PageHeader from '../../components/PageHeader';
import { useAuth } from '../../auth/AuthContext';

export default function Profile() {
  const { user } = useAuth();
  return (
    <>
      <PageHeader title="Profile" description="Your account details. Contact an administrator to change your email or role." />
      <div className="panel" style={{ maxWidth: '36rem' }}>
        <dl className="kv">
          <dt>Name</dt><dd>{user.name}</dd>
          <dt>Email</dt><dd>{user.email}</dd>
          <dt>Account type</dt><dd style={{ textTransform: 'capitalize' }}>{user.role}</dd>
        </dl>
      </div>
    </>
  );
}
