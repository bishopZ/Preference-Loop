import { useCallback, useEffect, useRef, useState } from 'react';
import { Text, VStack } from '@chakra-ui/react';
import { FormattedMessage } from 'react-intl';
import { PageLayout } from '../ui/layout/page-layout';
import { PageMeta } from '../ui/components/page-meta';
import { LoadingSpinner } from '../ui/components/loading-spinner';
import { VotingCard } from '../ui/components/voting-card';
import {
  fetchRandomPerson,
  sendSignal,
  type Person,
  type SignalEvent,
} from '../utilities/people-api';

/**
 * Public voting loop at `/` (ADR-CLU-01). Fetches a fairness-weighted
 * random eligible person, fires `shown` once per person on render
 * (ADR-D-02), and advances on Like (`positive`) or Skip (`trial`).
 * An empty eligible pool renders the F-12 empty state, not an error.
 */
const VotingLoop = () => {
  const [person, setPerson] = useState<Person | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Tracks the person id we have already emitted `shown` for, so React 18
  // Strict Mode (double-invoked effects) never double-counts a render (R-02).
  const shownFor = useRef<string | null>(null);

  // Does not set `loading` synchronously: `loading` starts true on mount, and
  // the vote handler flips it before re-calling this. Keeping setState out of
  // the synchronous path lets the mount effect call it without cascading
  // renders (react-hooks/set-state-in-effect).
  const loadNext = useCallback(() => {
    fetchRandomPerson()
      .then((next) => {
        setPerson(next);
        setError(null);
        setLoading(false);
      })
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    loadNext();
  }, [loadNext]);

  // Fire `shown` exactly once per distinct person (ADR-D-02).
  useEffect(() => {
    if (!person) return;
    if (shownFor.current === person.id) return;
    shownFor.current = person.id;
    void sendSignal(person.id, 'shown').catch(() => {
      // A dropped `shown` signal must not break the loop for the voter.
    });
  }, [person]);

  const vote = (event: Extract<SignalEvent, 'positive' | 'trial'>) => {
    if (!person) return;
    setLoading(true);
    sendSignal(person.id, event)
      .then(loadNext)
      .catch((caught: unknown) => {
        setError(caught instanceof Error ? caught.message : String(caught));
        setLoading(false);
      });
  };

  const renderBody = () => {
    if (loading && !person) return <LoadingSpinner />;
    if (error) {
      return (
        <Text color="red.500" data-testid="voting-error" textAlign="center">
          {error}
        </Text>
      );
    }
    if (!person) {
      return (
        <Text color="gray.500" data-testid="voting-empty" textAlign="center" fontSize="lg">
          <FormattedMessage id="voting.empty" />
        </Text>
      );
    }
    return (
      <VotingCard
        person={person}
        disabled={loading}
        onUpvote={() => { vote('positive'); }}
        onSkip={() => { vote('trial'); }}
      />
    );
  };

  return (
    <PageLayout maxW="container.md" py={12}>
      <PageMeta
        title="Recommendation Engine"
        description="Vote on people to help tune the recommendation engine."
      />
      <VStack gap={8} align="stretch">
        {renderBody()}
      </VStack>
    </PageLayout>
  );
};

export default VotingLoop;
