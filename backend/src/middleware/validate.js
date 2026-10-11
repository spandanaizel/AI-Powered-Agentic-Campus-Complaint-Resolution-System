import { badRequest } from '../utils/errors.js';

/** Validate req[part] with a zod schema; replaces it with the parsed (whitelisted) value. */
export const validate = (schema, part = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[part] ?? {});
  if (!result.success) {
    const details = result.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message }));
    return next(badRequest('Some fields are invalid', details));
  }
  if (part === 'query') req.validQuery = result.data; // Express 5 req.query is read-only
  else req[part] = result.data;
  return next();
};
