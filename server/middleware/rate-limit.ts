import rateLimit from "express-rate-limit";

export const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "För många försök från denna IP-adress. Försök igen om 15 minuter." },
  skip: () => process.env.NODE_ENV === "test",
});

export const mobileLoginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: "draft-7",
  legacyHeaders: false,
  message: { error: "För många inloggningsförsök. Försök igen om 15 minuter." },
  skip: () => process.env.NODE_ENV === "test",
});
