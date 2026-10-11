/** Landing page for each role's portal. */
export const homeFor = (role) => ({ student: '/student', staff: '/staff', admin: '/admin' }[role] || '/login');
