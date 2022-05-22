import { useContext } from 'react';
import { StakingContext } from '../context/StakingContext';
import { StakingContextProps } from '../types/types';

export function useStakingContext(): StakingContextProps {
  return useContext(StakingContext);
}
