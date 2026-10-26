import { useCallback, useState } from 'react';
import type { z } from 'zod';

import { fieldErrorsFromZod, type FieldErrors } from '@/lib/form-errors';

export interface FormFields<TField extends string> {
  values: Record<TField, string>;
  errors: FieldErrors<TField>;
  /** Updates one value and clears that field's error, so feedback follows what the user fixes. */
  setValue: (field: TField, value: string) => void;
  setErrors: (errors: FieldErrors<TField>) => void;
  /**
   * Validates the current values (plus any `extra` input that is not a form field, such as a link
   * token); returns the parsed data, or shows the field errors.
   */
  validate: <TSchema extends z.ZodType>(
    schema: TSchema,
    extra?: Readonly<Record<string, unknown>>,
  ) => z.output<TSchema> | undefined;
  reset: (values?: Record<TField, string>) => void;
}

/** Minimal controlled-form state for text fields, validated with the shared Zod schemas. */
export function useFormFields<TField extends string>(
  initialValues: Record<TField, string>,
): FormFields<TField> {
  const [values, setValues] = useState(initialValues);
  const [errors, setErrors] = useState<FieldErrors<TField>>({});
  const fields = Object.keys(initialValues).filter((key): key is TField => key in initialValues);

  const setValue = useCallback((field: TField, value: string) => {
    setValues((current) => ({ ...current, [field]: value }));
    setErrors((current) =>
      current[field] === undefined ? current : { ...current, [field]: undefined },
    );
  }, []);

  const validate = <TSchema extends z.ZodType>(
    schema: TSchema,
    extra: Readonly<Record<string, unknown>> = {},
  ): z.output<TSchema> | undefined => {
    const result = schema.safeParse({ ...values, ...extra });
    if (result.success) {
      setErrors({});
      return result.data;
    }
    setErrors(fieldErrorsFromZod(result.error, fields));
    return undefined;
  };

  const reset = (next: Record<TField, string> = initialValues): void => {
    setValues(next);
    setErrors({});
  };

  return { values, errors, setValue, setErrors, validate, reset };
}
