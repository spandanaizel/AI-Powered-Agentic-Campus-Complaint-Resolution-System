import { describe, it, expect } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockApi, renderApp, me, anon, empty, stats } from './utils';

const common = { 'GET /api/complaints': empty, 'GET /api/complaints/stats': stats, 'GET /api/categories': [200, { items: [] }] };

describe('role-aware routing (UX guard; the API enforces access separately)', () => {
  it('unauthenticated users are sent to sign in', async () => {
    mockApi({ 'GET /api/auth/me': anon });
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: 'Sign in' })).toBeInTheDocument();
  });
  it('a student opening an admin URL lands in the student portal', async () => {
    mockApi({ 'GET /api/auth/me': me('student'), ...common });
    renderApp('/admin/users');
    expect(await screen.findByRole('heading', { name: /Hello, Pat/ })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: 'Student portal' })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Users/ })).not.toBeInTheDocument();
  });
  it('staff opening a student URL lands in their queue', async () => {
    mockApi({ 'GET /api/auth/me': me('staff'), ...common });
    renderApp('/student/complaints/new');
    expect(await screen.findByRole('heading', { name: 'My queue' })).toBeInTheDocument();
    expect(await screen.findByText('Nothing is assigned to you')).toBeInTheDocument();
  });
  it('admin sees admin navigation and the logo links to the portal home', async () => {
    mockApi({ 'GET /api/auth/me': me('admin'), ...common });
    renderApp('/admin/complaints');
    expect(await screen.findByRole('heading', { name: 'All complaints' })).toBeInTheDocument();
    const nav = screen.getByRole('navigation', { name: 'Admin portal' });
    for (const label of ['Overview', 'All complaints', 'Repeated issues', 'Staff coverage', 'Users', 'Reports', 'Settings']) {
      expect(nav).toContainElement(screen.getByRole('link', { name: label }));
    }
    expect(screen.getAllByRole('link', { name: /go to portal home/ })[0]).toHaveAttribute('href', '/admin');
  });
  it('unknown URLs show the not-found page', async () => {
    mockApi({ 'GET /api/auth/me': me('student') });
    renderApp('/no/such/page');
    expect(await screen.findByRole('heading', { name: 'This page doesn’t exist' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Go to your portal' })).toHaveAttribute('href', '/student');
  });
});

describe('sign in', () => {
  it('validates inline, shows the generic server error, then signs in and routes by role', async () => {
    let attempt = 0;
    mockApi({
      'GET /api/auth/me': anon,
      'POST /api/auth/login': () => (++attempt === 1 ? [401, { error: { message: 'Invalid email or password' } }] : me('staff')),
      ...common,
    });
    const user = userEvent.setup();
    renderApp('/login');
    await user.click(await screen.findByRole('button', { name: 'Sign in' }));
    expect(screen.getByText('Enter your email address.')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true');
    await user.type(screen.getByLabelText('Email'), 'pat@uni.test');
    await user.type(screen.getByLabelText('Password'), 'wrong');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password');
    await user.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'My queue' })).toBeInTheDocument();
  });
});
