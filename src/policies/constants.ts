/** The numbers the code needs from `policy_settings`. A missing one stops the service at startup. */
export const SETTING_KEYS = {
  RETURN_WINDOW_DAYS: 'return_window_days',
  DEFECT_WINDOW_DAYS: 'defect_window_days',
  AUTO_APPROVE_LIMIT: 'auto_approve_limit',
} as const;

/** Settings whose name ends like this are money and print with two decimals in rule text. */
export const MONEY_SETTING_SUFFIX = '_limit';
