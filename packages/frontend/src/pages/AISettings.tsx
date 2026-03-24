import React, { useEffect, useCallback, useState } from 'react';
import { Box, Typography, Alert, CircularProgress, Grid } from '@mui/material';
import { useSnackbar } from '../contexts/SnackbarContext';
import { RootState } from '../store';
import { loadProviders, updateProvider } from '../store/slices/aiSlice';
import { ProviderCard } from '../components/ProviderCard';
import { useAuth } from '../contexts/AuthContext';
import { AIProviderConfig, LLMProvider } from '@admin-ai/shared/types/ai';
import { logger } from '../utils/logger';
import { useAppDispatch, useAppSelector } from '../hooks/redux';
import { aiSettingsService } from '../services/aiSettings.service';

interface SaveProviderSettings {
  apiKey: string;
  selectedModel: string;
  isActive: boolean;
  provider: LLMProvider;
}

const defaultProviders: Record<LLMProvider, AIProviderConfig> = {
  openai: {
    id: 'openai',
    provider: 'openai',
    name: 'OpenAI',
    description: 'Integrate with OpenAI models like GPT-4 and GPT-3.5',
    icon: '🤖',
    defaultModel: 'gpt-4',
    selectedModel: 'gpt-4',
    apiKeyPlaceholder: 'sk-...',
    isActive: false
  },
  gemini: {
    id: 'gemini',
    provider: 'gemini',
    name: 'Google Gemini',
    description: 'Access Google\'s latest AI models',
    icon: '🧠',
    defaultModel: 'gemini-2.0-flash',
    selectedModel: 'gemini-2.0-flash',
    apiKeyPlaceholder: 'API Key',
    isActive: false
  },
  anthropic: {
    id: 'anthropic',
    provider: 'anthropic',
    name: 'Anthropic',
    description: 'Use Claude and other Anthropic models',
    icon: '🌟',
    defaultModel: 'claude-3-opus',
    selectedModel: 'claude-3-opus',
    apiKeyPlaceholder: 'sk-ant-...',
    isActive: false
  },
  openclaw: {
    id: 'openclaw',
    provider: 'openclaw',
    name: 'OpenClaw',
    description: 'Connect your personal AI assistant with business skills — website builder, content creation, social media, email outreach, analytics, and invoicing',
    icon: '🦞',
    defaultModel: 'openclaw-gateway',
    selectedModel: 'openclaw-gateway',
    apiKeyPlaceholder: 'http://localhost:4767 (Gateway URL)',
    isActive: false
  }
} as const;

export const AISettings: React.FC = () => {
  const dispatch = useAppDispatch();
  const { showSuccess, showError } = useSnackbar();
  const { user } = useAuth();
  const [allProviders, setAllProviders] = useState<AIProviderConfig[]>([]);
  
  const {
    providers,
    isLoading,
    error
  } = useAppSelector((state: RootState) => state.ai);

  useEffect(() => {
    if (user) {
      void dispatch(loadProviders());
    }
  }, [dispatch, user]);

  // Merge database providers with default providers
  useEffect(() => {
    const mergedProviders: AIProviderConfig[] = Object.values(defaultProviders).map(defaultProvider => {
      const dbProvider = providers.find(p => p.provider === defaultProvider.provider);
      
      if (dbProvider) {
        // If the provider is Gemini, ensure the model name is correct
        if (dbProvider.provider === 'gemini') {
          return {
            ...dbProvider,
            defaultModel: 'gemini-2.0-flash',
            selectedModel: dbProvider.selectedModel || 'gemini-2.0-flash'
          };
        }
        return dbProvider;
      }
      
      return defaultProvider;
    });
    
    setAllProviders(mergedProviders);
  }, [providers]);

  const handleSave = useCallback(async (settings: SaveProviderSettings) => {
    try {
      // If the provider is Gemini, ensure we're using the correct model name
      if (settings.provider === 'gemini') {
        settings.selectedModel = 'gemini-2.0-flash';
      }
      
      await dispatch(updateProvider({ provider: settings.provider, settings })).unwrap();
      showSuccess('Provider settings saved successfully');
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to save provider settings:', error);
      showError('Failed to save provider settings');
    }
  }, [dispatch, showSuccess, showError]);

  const handleVerify = useCallback(async (provider: LLMProvider) => {
    try {
      await aiSettingsService.verifyProvider(provider);
      showSuccess('Provider verified successfully');
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to verify provider:', error);
      showError('Failed to verify provider');
    }
  }, [showSuccess, showError]);

  const handleDelete = useCallback(async (provider: LLMProvider) => {
    try {
      await aiSettingsService.deleteProvider(provider);
      await dispatch(loadProviders());
      showSuccess('Provider deleted successfully');
    } catch (err) {
      const error = err as Error;
      logger.error('Failed to delete provider:', error);
      showError('Failed to delete provider');
    }
  }, [dispatch, showSuccess, showError]);

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">
          Please log in to access AI settings
        </Alert>
      </Box>
    );
  }

  if (isLoading && allProviders.length === 0) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="error">
          {error}
        </Alert>
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      <Typography variant="h4" gutterBottom>
        AI Provider Settings
      </Typography>
      <Typography variant="body1" sx={{ mb: 3 }}>
        Configure your AI providers to enable AI features in the dashboard. You need at least one active provider.
      </Typography>
      
      <Grid container spacing={3}>
        {allProviders.map((config: AIProviderConfig) => (
          <Grid item xs={12} md={4} key={config.provider}>
            <ProviderCard
              provider={{
                id: config.provider,
                name: config.provider === 'openai' ? 'OpenAI' : 
                      config.provider === 'gemini' ? 'Google Gemini' : 
                      config.provider === 'anthropic' ? 'Anthropic' :
                      config.provider === 'openclaw' ? 'OpenClaw' : config.provider,
                description: config.provider === 'openai' ? 'Integrate with OpenAI models like GPT-4 and GPT-3.5' :
                            config.provider === 'gemini' ? 'Access Google\'s latest AI models' :
                            config.provider === 'anthropic' ? 'Use Claude and other Anthropic models' :
                            config.provider === 'openclaw' ? 'Connect your personal AI assistant with business skills' : '',
                icon: config.provider === 'openai' ? '🤖' :
                      config.provider === 'gemini' ? '🧠' :
                      config.provider === 'anthropic' ? '🌟' :
                      config.provider === 'openclaw' ? '🦞' : '🔌',
                defaultModel: config.provider === 'openai' ? 'gpt-4' :
                             config.provider === 'gemini' ? 'gemini-2.0-flash' :
                             config.provider === 'anthropic' ? 'claude-3-opus' :
                             config.provider === 'openclaw' ? 'openclaw-gateway' : '',
                apiKeyPlaceholder: config.provider === 'openai' ? 'sk-...' :
                                  config.provider === 'gemini' ? 'API Key' :
                                  config.provider === 'anthropic' ? 'sk-ant-...' :
                                  config.provider === 'openclaw' ? 'http://localhost:4767 (Gateway URL)' : 'API Key',
                provider: config.provider
              }}
              config={config}
              onSave={(settings) => handleSave({ ...settings, provider: config.provider })}
              onVerify={() => handleVerify(config.provider)}
              onDelete={() => handleDelete(config.provider)}
            />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
};
