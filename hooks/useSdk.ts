import { useContext } from 'react';
import { SdkContext } from '../context/SdkContext';
import { SdkProps } from '../types/types';

export function useSdk(): SdkProps {
  return useContext(SdkContext);
}
