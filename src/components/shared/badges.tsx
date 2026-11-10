import { Badge } from '@/components/ui/card'
import { CONTACT_RESULT, SITUATION, STAGE } from '@/domain/labels'
import type { ContactResult, CustomerSituation, PredictionStage } from '@/types/models'

export const StageBadge = ({ stage }: { stage: PredictionStage }) => (
  <Badge tone={STAGE[stage].tone} dot>
    {STAGE[stage].label}
  </Badge>
)

export const SituationBadge = ({ situation }: { situation: CustomerSituation }) => (
  <Badge tone={SITUATION[situation].tone} dot>
    {SITUATION[situation].label}
  </Badge>
)

export const ResultBadge = ({ result }: { result: ContactResult }) => (
  <Badge tone={CONTACT_RESULT[result].tone}>{CONTACT_RESULT[result].label}</Badge>
)
