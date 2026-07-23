import { useEffect, useState } from 'react';
import { Badge, Flex, Heading, Table, Text, VStack } from '@chakra-ui/react';
import { FormattedMessage } from 'react-intl';
import { useNavigate } from 'react-router';
import { PageLayout } from '../../ui/layout/page-layout';
import { AnimatedButton } from '../../ui/components/animated-button';
import { LoadingSpinner } from '../../ui/components/loading-spinner';
import { PageMeta } from '../../ui/components/page-meta';
import { adminPeopleEditPath, ROUTES } from '../../utilities/constants';
import { Link } from '../../ui/components/link';
import {
  deletePerson,
  fetchAdminPeople,
  UnauthenticatedError,
  type Person,
} from '../../utilities/people-api';

type EligibilityFilter = 'all' | 'eligible' | 'ineligible';

const FILTERS: { value: EligibilityFilter; labelId: string }[] = [
  { value: 'all', labelId: 'admin.people.filterAll' },
  { value: 'eligible', labelId: 'admin.people.filterEligible' },
  { value: 'ineligible', labelId: 'admin.people.filterIneligible' },
];

/** Eligibility is derived from the presence of a Wikipedia title (ADR-D-03). */
const isEligible = (person: Person): boolean => person.wikipedia_article_title !== null;

const applyFilter = (people: Person[], filter: EligibilityFilter): Person[] => {
  if (filter === 'all') return people;
  return people.filter((person) => isEligible(person) === (filter === 'eligible'));
};

interface PersonRowProps {
  person: Person;
  confirming: boolean;
  onDeleteRequest: (id: string | null) => void;
  onDeleteConfirm: (id: string) => void;
}

const PersonRow = ({ person, confirming, onDeleteRequest, onDeleteConfirm }: PersonRowProps) => (
  <Table.Row data-testid="person-row">
    <Table.Cell data-testid="person-row-name">{person.name}</Table.Cell>
    <Table.Cell>
      <Badge colorPalette={isEligible(person) ? 'green' : 'gray'} data-testid="person-row-eligibility">
        <FormattedMessage id={isEligible(person) ? 'admin.people.eligible' : 'admin.people.ineligible'} />
      </Badge>
    </Table.Cell>
    <Table.Cell textAlign="end">{person.shown_count}</Table.Cell>
    <Table.Cell textAlign="end">{person.trial_count}</Table.Cell>
    <Table.Cell textAlign="end">{person.positive_count}</Table.Cell>
    <Table.Cell>
      {confirming ? (
        <Flex gap={2} align="center">
          <Text fontSize="sm"><FormattedMessage id="admin.people.deleteConfirm" /></Text>
          <AnimatedButton
            size="xs"
            colorPalette="red"
            data-testid="person-delete-confirm"
            onClick={() => { onDeleteConfirm(person.id); }}
          >
            <FormattedMessage id="admin.people.delete" />
          </AnimatedButton>
          <AnimatedButton size="xs" variant="outline" onClick={() => { onDeleteRequest(null); }}>
            <FormattedMessage id="admin.people.cancel" />
          </AnimatedButton>
        </Flex>
      ) : (
        <Flex gap={2}>
          <AnimatedButton size="xs" variant="outline" asChild data-testid="person-edit">
            <Link to={adminPeopleEditPath(person.id)}>
              <FormattedMessage id="admin.people.editAction" />
            </Link>
          </AnimatedButton>
          <AnimatedButton
            size="xs"
            variant="outline"
            colorPalette="red"
            data-testid="person-delete"
            onClick={() => { onDeleteRequest(person.id); }}
          >
            <FormattedMessage id="admin.people.delete" />
          </AnimatedButton>
        </Flex>
      )}
    </Table.Cell>
  </Table.Row>
);

const usePeople = () => {
  const navigate = useNavigate();
  const [people, setPeople] = useState<Person[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAdminPeople()
      .then((rows) => {
        if (cancelled) return;
        setPeople(rows);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        if (cancelled) return;
        if (caught instanceof UnauthenticatedError) {
          void navigate(ROUTES.LOGIN);
          return;
        }
        setError(caught instanceof Error ? caught.message : String(caught));
        setLoading(false);
      });
    return () => { cancelled = true; };
  }, [navigate]);

  return { people, setPeople, loading, error, setError };
};

const PeopleDashboard = () => {
  const { people, setPeople, loading, error, setError } = usePeople();
  const [filter, setFilter] = useState<EligibilityFilter>('all');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const handleDelete = (id: string) => {
    deletePerson(id)
      .then(() => {
        setPeople((previous) => previous.filter((person) => person.id !== id));
        setConfirmingId(null);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
        setConfirmingId(null);
      });
  };

  const visible = applyFilter(people, filter);

  const renderBody = () => {
    if (loading) return <LoadingSpinner />;
    if (visible.length === 0) {
      return (
        <Text color="gray.500" data-testid="people-empty">
          <FormattedMessage id="admin.people.empty" />
        </Text>
      );
    }
    return (
      <Table.Root size="sm" data-testid="people-table">
        <Table.Header>
          <Table.Row>
            <Table.ColumnHeader><FormattedMessage id="admin.people.name" /></Table.ColumnHeader>
            <Table.ColumnHeader><FormattedMessage id="admin.people.eligible" /></Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end"><FormattedMessage id="admin.people.shown" /></Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end"><FormattedMessage id="admin.people.trials" /></Table.ColumnHeader>
            <Table.ColumnHeader textAlign="end"><FormattedMessage id="admin.people.positives" /></Table.ColumnHeader>
            <Table.ColumnHeader><FormattedMessage id="admin.people.actions" /></Table.ColumnHeader>
          </Table.Row>
        </Table.Header>
        <Table.Body>
          {visible.map((person) => (
            <PersonRow
              key={person.id}
              person={person}
              confirming={confirmingId === person.id}
              onDeleteRequest={setConfirmingId}
              onDeleteConfirm={handleDelete}
            />
          ))}
        </Table.Body>
      </Table.Root>
    );
  };

  return (
    <PageLayout variant="private" maxW="container.lg">
      <PageMeta
        title="People - Recommendation Engine"
        description="Manage the people pool for the recommendation engine"
      />
      <VStack gap={6} align="stretch">
        <Flex justify="space-between" align="center" wrap="wrap" gap={3}>
          <Heading as="h1" size="2xl">
            <FormattedMessage id="admin.people.title" />
          </Heading>
          <AnimatedButton colorScheme="blue" asChild data-testid="person-new">
            <Link to={ROUTES.ADMIN_PEOPLE_NEW}>
              <FormattedMessage id="admin.people.new" />
            </Link>
          </AnimatedButton>
        </Flex>

        <Flex gap={2}>
          {FILTERS.map(({ value, labelId }) => (
            <AnimatedButton
              key={value}
              size="sm"
              variant={filter === value ? 'solid' : 'outline'}
              data-testid={`filter-${value}`}
              onClick={() => { setFilter(value); }}
            >
              <FormattedMessage id={labelId} />
            </AnimatedButton>
          ))}
        </Flex>

        {error && <Text color="red.500" data-testid="people-error">{error}</Text>}
        {renderBody()}
      </VStack>
    </PageLayout>
  );
};

export default PeopleDashboard;
