import { useEffect, useState } from 'react';
import { Heading, Input, Text, VStack, Field, Flex } from '@chakra-ui/react';
import { FormattedMessage, useIntl } from 'react-intl';
import { useNavigate, useParams } from 'react-router';
import { PageLayout } from '../../ui/layout/page-layout';
import { AnimatedButton } from '../../ui/components/animated-button';
import { LoadingSpinner } from '../../ui/components/loading-spinner';
import { PageMeta } from '../../ui/components/page-meta';
import { ROUTES } from '../../utilities/constants';
import {
  createPerson,
  fetchAdminPeople,
  updatePerson,
  UnauthenticatedError,
  type Person,
  type PersonInput,
} from '../../utilities/people-api';

interface FormValues {
  name: string;
  imdbNameId: string;
  slug: string;
  wikiTitle: string;
  wikiUrl: string;
  wikiImage: string;
}

const EMPTY_VALUES: FormValues = {
  name: '',
  imdbNameId: '',
  slug: '',
  wikiTitle: '',
  wikiUrl: '',
  wikiImage: '',
};

const isValidUrl = (value: string): boolean => {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
};

/** F-14 inline validation: name required; URL fields must parse when non-empty. */
const validate = (values: FormValues): Partial<Record<keyof FormValues, string>> => {
  const errors: Partial<Record<keyof FormValues, string>> = {};
  if (values.name.trim().length === 0) errors.name = 'admin.people.nameRequired';
  if (values.wikiUrl.trim().length > 0 && !isValidUrl(values.wikiUrl.trim())) {
    errors.wikiUrl = 'admin.people.invalidUrl';
  }
  if (values.wikiImage.trim().length > 0 && !isValidUrl(values.wikiImage.trim())) {
    errors.wikiImage = 'admin.people.invalidUrl';
  }
  return errors;
};

const toInput = (values: FormValues): PersonInput => ({
  name: values.name.trim(),
  imdb_name_id: values.imdbNameId.trim() || null,
  slug: values.slug.trim() || null,
  wikipedia_article_title: values.wikiTitle.trim() || null,
  wikipedia_page_url: values.wikiUrl.trim() || null,
  wikipedia_image_url: values.wikiImage.trim() || null,
});

const toValues = (person: Person): FormValues => ({
  name: person.name,
  imdbNameId: person.imdb_name_id ?? '',
  slug: person.slug ?? '',
  wikiTitle: person.wikipedia_article_title ?? '',
  wikiUrl: person.wikipedia_page_url ?? '',
  wikiImage: person.wikipedia_image_url ?? '',
});

interface PersonFieldProps {
  field: keyof FormValues;
  /** Locale message id — used when label is omitted. */
  labelId?: string;
  /** Plain English label for admin-only fields (no i18n). */
  label?: string;
  values: FormValues;
  errors: Partial<Record<keyof FormValues, string>>;
  onChange: (field: keyof FormValues, value: string) => void;
}

const PersonField = ({ field, labelId, label, values, errors, onChange }: PersonFieldProps) => {
  const intl = useIntl();
  const errorId = errors[field];
  const resolvedLabel = label ?? (labelId ? intl.formatMessage({ id: labelId }) : field);

  return (
    <Field.Root invalid={Boolean(errorId)} required={field === 'name'}>
      <Field.Label>{resolvedLabel}</Field.Label>
      <Input
        data-testid={`person-${field}-input`}
        value={values[field]}
        onChange={(event) => { onChange(field, event.target.value); }}
      />
      {errorId && (
        <Field.ErrorText data-testid={`person-${field}-error`}>
          {intl.formatMessage({ id: errorId })}
        </Field.ErrorText>
      )}
    </Field.Root>
  );
};

/** Loads people (auth probe in create mode, prefill source in edit mode — ADR-D-01). */
const usePersonFormLoad = (
  id: string | undefined,
  apply: (values: FormValues) => void
) => {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [missing, setMissing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetchAdminPeople()
      .then((people) => {
        if (cancelled) return;
        if (id) {
          const person = people.find((row) => row.id === id);
          if (person) apply(toValues(person));
          else setMissing(true);
        }
        setLoading(false);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        if (error instanceof UnauthenticatedError) void navigate(ROUTES.LOGIN);
        else setMissing(true);
        setLoading(false);
      });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- apply is a stable setState wrapper
  }, [id, navigate]);

  return { loading, missing };
};

const PersonForm = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const intl = useIntl();
  const [values, setValues] = useState<FormValues>(EMPTY_VALUES);
  const [errors, setErrors] = useState<Partial<Record<keyof FormValues, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const { loading, missing } = usePersonFormLoad(id, setValues);

  const handleChange = (field: keyof FormValues, value: string) => {
    setValues((previous) => ({ ...previous, [field]: value }));
  };

  const handleSubmit = async (event: React.SyntheticEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextErrors = validate(values);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length > 0) return;

    setSubmitting(true);
    setServerError(null);
    try {
      if (id) await updatePerson(id, toInput(values));
      else await createPerson(toInput(values));
      await navigate(ROUTES.ADMIN_PEOPLE);
    } catch (error) {
      if (error instanceof UnauthenticatedError) {
        await navigate(ROUTES.LOGIN);
        return;
      }
      setServerError(error instanceof Error ? error.message : String(error));
      setSubmitting(false);
    }
  };

  const titleId = id ? 'admin.people.edit' : 'admin.people.new';

  return (
    <PageLayout variant="private" maxW="container.sm">
      <PageMeta
        title={`${intl.formatMessage({ id: titleId })} - Recommendation Engine`}
        description="Create or edit a person in the recommendation pool"
      />
      {loading ? (
        <LoadingSpinner />
      ) : (
        <VStack gap={6} align="stretch">
          <Heading as="h1" size="2xl">
            <FormattedMessage id={titleId} />
          </Heading>
          {missing ? (
            <Text data-testid="person-form-missing" color="red.500">
              <FormattedMessage id="admin.people.notFound" />
            </Text>
          ) : (
            <form onSubmit={(event) => { void handleSubmit(event); }} noValidate>
              <VStack gap={4} align="stretch">
                <PersonField field="name" labelId="admin.people.name" values={values} errors={errors} onChange={handleChange} />
                <PersonField field="imdbNameId" label="IMDb ID" values={values} errors={errors} onChange={handleChange} />
                <PersonField field="slug" label="Slug" values={values} errors={errors} onChange={handleChange} />
                <PersonField field="wikiTitle" labelId="admin.people.wikiTitle" values={values} errors={errors} onChange={handleChange} />
                <PersonField field="wikiUrl" labelId="admin.people.wikiUrl" values={values} errors={errors} onChange={handleChange} />
                <PersonField field="wikiImage" labelId="admin.people.wikiImage" values={values} errors={errors} onChange={handleChange} />
                {serverError && (
                  <Text data-testid="person-form-error" color="red.500">{serverError}</Text>
                )}
                <Flex gap={3}>
                  <AnimatedButton
                    type="submit"
                    colorScheme="blue"
                    loading={submitting}
                    data-testid="person-form-submit"
                  >
                    <FormattedMessage id="admin.people.save" />
                  </AnimatedButton>
                  <AnimatedButton
                    variant="outline"
                    onClick={() => { void navigate(ROUTES.ADMIN_PEOPLE); }}
                  >
                    <FormattedMessage id="admin.people.cancel" />
                  </AnimatedButton>
                </Flex>
              </VStack>
            </form>
          )}
        </VStack>
      )}
    </PageLayout>
  );
};

export default PersonForm;
