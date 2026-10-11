// Client-side form checks mirroring the API's rules. The server validates again; these exist for fast, clear feedback.

export const MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export function validateRegistration({ name, email, password, confirm }) {
  const e = {};
  if (name.trim().length < 2) e.name = 'Enter your full name.';
  if (!/^\S+@\S+\.\S+$/.test(email)) e.email = 'Enter a valid email address.';
  if (password.length < 8) e.password = 'Use at least 8 characters.';
  else if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) e.password = 'Include at least one letter and one number.';
  if (confirm !== password) e.confirm = 'Passwords do not match.';
  return e;
}

export function validateComplaint(f) {
  const e = {};
  if (f.title.trim().length < 5) e.title = 'Give a short title of at least 5 characters.';
  else if (f.title.length > 150) e.title = 'Keep the title under 150 characters.';
  if (!f.categoryId) e.categoryId = 'Choose what kind of problem this is.';
  if (!f.locationId) e.locationId = 'Choose where the problem is.';
  if (f.description.trim().length < 20) e.description = 'Describe the problem in at least 20 characters.';
  if (f.file && !IMAGE_TYPES.includes(f.file.type)) e.attachment = 'Attach a JPEG, PNG or WebP image.';
  else if (f.file && f.file.size > MAX_BYTES) e.attachment = 'The image must be 5 MB or smaller.';
  return e;
}
