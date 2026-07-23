import { Box, Flex, Heading, Image, Text, VStack } from '@chakra-ui/react';
import { FormattedMessage } from 'react-intl';
import { AnimatedButton } from './animated-button';
import { Link } from './link';
import { type Person } from '../../utilities/people-api';

interface VotingCardProps {
  person: Person;
  disabled?: boolean;
  onUpvote: () => void;
  onSkip: () => void;
}

/**
 * Presents a single person in the public voting loop: optional Wikipedia
 * image, name, an outbound Wikipedia link, and the Like / Skip controls.
 * Buttons are disabled while the next person is loading to prevent a
 * double signal on the same card.
 */
export const VotingCard = ({ person, disabled = false, onUpvote, onSkip }: VotingCardProps) => (
  <Box
    data-testid="voting-card"
    borderWidth="1px"
    borderRadius="xl"
    overflow="hidden"
    boxShadow="md"
    maxW="420px"
    w="full"
    mx="auto"
  >
    {person.wikipedia_image_url && (
      <Image
        src={person.wikipedia_image_url}
        alt={person.name}
        w="full"
        maxH="360px"
        objectFit="cover"
        data-testid="person-image"
      />
    )}
    <VStack gap={5} align="stretch" p={6}>
      <Heading as="h2" size="xl" textAlign="center" data-testid="person-name">
        {person.name}
      </Heading>

      {person.wikipedia_page_url && (
        <Text textAlign="center" fontSize="sm">
          <Link to={person.wikipedia_page_url} isExternal>
            <FormattedMessage id="voting.wikiLink" />
          </Link>
        </Text>
      )}

      <Flex gap={4} justify="center" pt={2}>
        <AnimatedButton
          colorPalette="green"
          size="lg"
          data-testid="vote-upvote"
          disabled={disabled}
          onClick={onUpvote}
        >
          <FormattedMessage id="voting.upvote" />
        </AnimatedButton>
        <AnimatedButton
          variant="outline"
          size="lg"
          data-testid="vote-skip"
          disabled={disabled}
          onClick={onSkip}
        >
          <FormattedMessage id="voting.skip" />
        </AnimatedButton>
      </Flex>
    </VStack>
  </Box>
);
