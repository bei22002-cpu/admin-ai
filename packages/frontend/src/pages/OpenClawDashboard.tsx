import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  Box,
  Typography,
  Grid,
  Card,
  CardContent,
  CardActions,
  Button,
  Switch,
  Chip,
  Alert,
  CircularProgress,
  Divider,
  TextField,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  List,
  ListItem,
  ListItemText,
  ListItemIcon,
  Collapse,
  Paper,
  Tabs,
  Tab,
  Stepper,
  Step,
  StepLabel,
  StepContent,
  useMediaQuery,
  useTheme
} from '@mui/material';
import {
  ExpandMore as ExpandMoreIcon,
  ExpandLess as ExpandLessIcon,
  PlayArrow as PlayIcon,
  Code as CodeIcon,
  Article as ArticleIcon,
  Share as ShareIcon,
  Email as EmailIcon,
  BarChart as BarChartIcon,
  Receipt as ReceiptIcon,
  Circle as CircleIcon,
  Send as SendIcon,
  Delete as DeleteIcon,
  Refresh as RefreshIcon,
  Settings as SettingsIcon,
  Chat as ChatIcon,
  Build as BuildIcon,
  RocketLaunch as RocketIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { openClawService, OpenClawSkill, OpenClawStatus, ConversationMessage } from '../services/openclaw.service';
import { logger } from '../utils/logger';

const categoryIcons: Record<string, React.ReactElement> = {
  'website-builder': <CodeIcon />,
  'content-creation': <ArticleIcon />,
  'social-media': <ShareIcon />,
  'email-outreach': <EmailIcon />,
  'analytics': <BarChartIcon />,
  'invoicing': <ReceiptIcon />
};

const categoryColors: Record<string, string> = {
  'website-builder': '#2196f3',
  'content-creation': '#9c27b0',
  'social-media': '#e91e63',
  'email-outreach': '#ff9800',
  'analytics': '#4caf50',
  'invoicing': '#607d8b'
};

// Onboarding setup wizard steps
const setupSteps = [
  {
    label: 'Configure Gateway',
    description: 'Set up your OpenClaw gateway URL in AI Settings to enable the connection between AdminAI and your OpenClaw assistant.',
  },
  {
    label: 'Enable Skills',
    description: 'Choose which business-building skills you want active. Toggle skills on/off based on your needs.',
  },
  {
    label: 'Send Your First Message',
    description: 'Try sending a message like "Build me a landing page" to test the integration.',
  },
];

export const OpenClawDashboard: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useSnackbar();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
  const isTablet = useMediaQuery(theme.breakpoints.down('md'));

  const [skills, setSkills] = useState<OpenClawSkill[]>([]);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [activeTab, setActiveTab] = useState(0);

  // Chat state
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Onboarding state
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [activeStep, setActiveStep] = useState(0);

  // Auto-refresh status
  const [refreshing, setRefreshing] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [skillsData, statusData] = await Promise.all([
        openClawService.getSkills(),
        openClawService.getStatus()
      ]);
      setSkills(skillsData);
      setStatus(statusData);

      // Show onboarding if not configured
      if (!statusData.connected && !statusData.gatewayUrl) {
        setShowOnboarding(true);
      }
    } catch (error) {
      logger.error('Failed to load OpenClaw data:', error);
      setSkills([]);
      setStatus({
        connected: false,
        gatewayUrl: '',
        activeSkills: 0,
        totalSkills: 0,
        channels: []
      });
      setShowOnboarding(true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadConversationHistory = useCallback(async () => {
    try {
      setLoadingHistory(true);
      const data = await openClawService.getConversationHistory();
      setMessages(data.messages);
    } catch (error) {
      logger.error('Failed to load conversation history:', error);
    } finally {
      setLoadingHistory(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadData();
      void loadConversationHistory();
    }
  }, [user, loadData, loadConversationHistory]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // Auto-refresh status every 30 seconds
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const statusData = await openClawService.getStatus();
        setStatus(statusData);
      } catch {
        // Silently fail on background refresh
      }
    }, 30000);
    return () => clearInterval(interval);
  }, []);

  const handleRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await loadData();
      showSuccess('Status refreshed');
    } catch {
      showError('Failed to refresh');
    } finally {
      setRefreshing(false);
    }
  }, [loadData, showSuccess, showError]);

  const handleToggleSkill = useCallback(async (skillId: string, enabled: boolean) => {
    try {
      await openClawService.toggleSkill(skillId, enabled);
      setSkills(prev => prev.map(s => s.id === skillId ? { ...s, enabled } : s));
      showSuccess(`Skill ${enabled ? 'enabled' : 'disabled'}`);
    } catch (error) {
      logger.error('Failed to toggle skill:', error);
      showError('Failed to toggle skill');
    }
  }, [showSuccess, showError]);

  const toggleExpanded = useCallback((skillId: string) => {
    setExpandedSkills(prev => {
      const next = new Set(prev);
      if (next.has(skillId)) {
        next.delete(skillId);
      } else {
        next.add(skillId);
      }
      return next;
    });
  }, []);

  const handleSendMessage = useCallback(async () => {
    if (!chatInput.trim()) return;

    const userMessage: ConversationMessage = {
      id: `temp-${Date.now()}`,
      userId: user?.id || '',
      role: 'user',
      content: chatInput,
      createdAt: new Date().toISOString()
    };
    setMessages(prev => [...prev, userMessage]);
    const input = chatInput;
    setChatInput('');

    try {
      setSendingMessage(true);
      const response = await openClawService.sendMessage(input);
      const assistantMessage: ConversationMessage = {
        id: `temp-${Date.now()}-resp`,
        userId: user?.id || '',
        role: 'assistant',
        content: response,
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      logger.error('Failed to send message:', error);
      const errorMessage: ConversationMessage = {
        id: `temp-${Date.now()}-err`,
        userId: user?.id || '',
        role: 'system',
        content: 'Failed to send message. Please check your connection and try again.',
        createdAt: new Date().toISOString()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setSendingMessage(false);
    }
  }, [chatInput, user]);

  const handleClearHistory = useCallback(async () => {
    try {
      await openClawService.clearConversationHistory();
      setMessages([]);
      showSuccess('Conversation history cleared');
    } catch (error) {
      logger.error('Failed to clear history:', error);
      showError('Failed to clear conversation history');
    }
  }, [showSuccess, showError]);

  const handleKeyPress = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  }, [handleSendMessage]);

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Please log in to access OpenClaw settings</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', alignItems: 'center', minHeight: 400 }}>
        <Box sx={{ textAlign: 'center' }}>
          <CircularProgress size={48} />
          <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
            Loading OpenClaw...
          </Typography>
        </Box>
      </Box>
    );
  }

  return (
    <Box sx={{ p: isMobile ? 1.5 : 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 2, flexWrap: 'wrap', gap: 1 }}>
        <Typography variant={isMobile ? 'h5' : 'h4'} sx={{ mr: 1 }}>
          OpenClaw Assistant
        </Typography>
        <Chip
          icon={<CircleIcon sx={{ fontSize: 12 }} />}
          label={status?.connected ? 'Connected' : 'Not Connected'}
          color={status?.connected ? 'success' : 'default'}
          size="small"
        />
        <Box sx={{ flexGrow: 1 }} />
        <Button
          size="small"
          variant="outlined"
          startIcon={refreshing ? <CircularProgress size={16} /> : <RefreshIcon />}
          onClick={handleRefresh}
          disabled={refreshing}
        >
          {isMobile ? '' : 'Refresh'}
        </Button>
      </Box>

      <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
        Your personal AI assistant with business-building skills. Automate website building,
        content creation, social media, email outreach, analytics, and invoicing.
      </Typography>

      {/* Onboarding Wizard */}
      {showOnboarding && (
        <Paper sx={{ p: isMobile ? 2 : 3, mb: 3, border: '1px solid', borderColor: 'primary.light', borderRadius: 2 }}>
          <Box sx={{ display: 'flex', alignItems: 'center', mb: 2 }}>
            <RocketIcon color="primary" sx={{ mr: 1 }} />
            <Typography variant="h6">Getting Started</Typography>
            <Box sx={{ flexGrow: 1 }} />
            <Button size="small" onClick={() => setShowOnboarding(false)}>
              Dismiss
            </Button>
          </Box>
          <Stepper activeStep={activeStep} orientation="vertical">
            {setupSteps.map((step, index) => (
              <Step key={step.label}>
                <StepLabel>{step.label}</StepLabel>
                <StepContent>
                  <Typography variant="body2" sx={{ mb: 2 }}>{step.description}</Typography>
                  <Box sx={{ display: 'flex', gap: 1 }}>
                    {index === 0 && (
                      <Button
                        size="small"
                        variant="contained"
                        startIcon={<SettingsIcon />}
                        onClick={() => window.location.href = '/ai-settings'}
                      >
                        Go to AI Settings
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant={index === 0 ? 'outlined' : 'contained'}
                      onClick={() => setActiveStep(index + 1)}
                    >
                      {index < setupSteps.length - 1 ? 'Next' : 'Done'}
                    </Button>
                    {index > 0 && (
                      <Button size="small" onClick={() => setActiveStep(index - 1)}>
                        Back
                      </Button>
                    )}
                  </Box>
                </StepContent>
              </Step>
            ))}
          </Stepper>
          {activeStep === setupSteps.length && (
            <Alert severity="success" sx={{ mt: 2 }}>
              Setup complete! You can now use OpenClaw to build your business.
            </Alert>
          )}
        </Paper>
      )}

      {/* Status Overview */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
        <Grid container spacing={2}>
          <Grid item xs={6} sm={3}>
            <Typography variant="overline" color="text.secondary">Gateway</Typography>
            <Typography variant="body2" noWrap>
              {status?.gatewayUrl || 'Not configured'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="overline" color="text.secondary">Active Skills</Typography>
            <Typography variant="h6">
              {status?.activeSkills ?? 0} / {status?.totalSkills ?? 0}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="overline" color="text.secondary">Last Heartbeat</Typography>
            <Typography variant="body2">
              {status?.lastHeartbeat ? new Date(status.lastHeartbeat).toLocaleString() : 'Never'}
            </Typography>
          </Grid>
          <Grid item xs={6} sm={3}>
            <Typography variant="overline" color="text.secondary">Channels</Typography>
            <Typography variant="body2">
              {status?.channels?.length ? status.channels.join(', ') : 'None configured'}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* Tabbed Content */}
      <Paper sx={{ mb: 3 }}>
        <Tabs
          value={activeTab}
          onChange={(_, v) => setActiveTab(v)}
          variant={isMobile ? 'fullWidth' : 'standard'}
          sx={{ borderBottom: 1, borderColor: 'divider' }}
        >
          <Tab icon={<ChatIcon />} label={isMobile ? '' : 'Chat'} iconPosition="start" />
          <Tab icon={<BuildIcon />} label={isMobile ? '' : 'Skills'} iconPosition="start" />
        </Tabs>

        {/* Chat Tab */}
        {activeTab === 0 && (
          <Box sx={{ p: 2 }}>
            {/* Chat Messages */}
            <Box
              sx={{
                height: isMobile ? 300 : 400,
                overflowY: 'auto',
                mb: 2,
                p: 1,
                bgcolor: 'background.default',
                borderRadius: 1,
              }}
            >
              {loadingHistory && (
                <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
                  <CircularProgress size={24} />
                </Box>
              )}
              {!loadingHistory && messages.length === 0 && (
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', opacity: 0.6 }}>
                  <ChatIcon sx={{ fontSize: 48, mb: 1 }} />
                  <Typography variant="body2">No messages yet. Start a conversation!</Typography>
                  <Typography variant="caption" color="text.secondary" sx={{ mt: 0.5 }}>
                    Try: "Build me a landing page" or "Write a blog post about AI"
                  </Typography>
                </Box>
              )}
              {messages.map((msg) => (
                <Box
                  key={msg.id}
                  sx={{
                    display: 'flex',
                    justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                    mb: 1,
                  }}
                >
                  <Paper
                    elevation={1}
                    sx={{
                      p: 1.5,
                      maxWidth: '80%',
                      bgcolor: msg.role === 'user'
                        ? 'primary.main'
                        : msg.role === 'system'
                        ? 'error.light'
                        : 'background.paper',
                      color: msg.role === 'user' ? 'primary.contrastText' : 'text.primary',
                      borderRadius: 2,
                    }}
                  >
                    <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                      {msg.content}
                    </Typography>
                    <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mt: 0.5 }}>
                      {new Date(msg.createdAt).toLocaleTimeString()}
                    </Typography>
                  </Paper>
                </Box>
              ))}
              <div ref={chatEndRef} />
            </Box>

            {/* Chat Input */}
            <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-end' }}>
              <TextField
                fullWidth
                multiline
                maxRows={3}
                size="small"
                placeholder="Type a message... (Enter to send, Shift+Enter for new line)"
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={handleKeyPress}
                disabled={sendingMessage}
              />
              <Button
                variant="contained"
                onClick={handleSendMessage}
                disabled={sendingMessage || !chatInput.trim()}
                sx={{ minWidth: isMobile ? 40 : 80, height: 40 }}
              >
                {sendingMessage ? <CircularProgress size={20} /> : isMobile ? <SendIcon /> : 'Send'}
              </Button>
              {messages.length > 0 && (
                <Button
                  variant="outlined"
                  color="error"
                  onClick={handleClearHistory}
                  sx={{ minWidth: 40, height: 40 }}
                  title="Clear history"
                >
                  <DeleteIcon fontSize="small" />
                </Button>
              )}
            </Box>
          </Box>
        )}

        {/* Skills Tab */}
        {activeTab === 1 && (
          <Box sx={{ p: 2 }}>
            <Grid container spacing={isMobile ? 2 : 3}>
              {skills.map((skill) => (
                <Grid item xs={12} sm={6} lg={4} key={skill.id}>
                  <Card
                    sx={{
                      height: '100%',
                      display: 'flex',
                      flexDirection: 'column',
                      borderLeft: `4px solid ${categoryColors[skill.category] || '#757575'}`,
                      transition: 'box-shadow 0.2s',
                      '&:hover': { boxShadow: 4 }
                    }}
                  >
                    <CardContent sx={{ flexGrow: 1 }}>
                      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 1 }}>
                        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                          {categoryIcons[skill.category]}
                          <Typography variant="subtitle1" fontWeight={600}>
                            {skill.name}
                          </Typography>
                        </Box>
                        <Switch
                          checked={skill.enabled}
                          onChange={(e) => handleToggleSkill(skill.id, e.target.checked)}
                          size="small"
                        />
                      </Box>

                      <Chip
                        label={skill.category.replace('-', ' ')}
                        size="small"
                        sx={{
                          mb: 1,
                          bgcolor: categoryColors[skill.category] || '#757575',
                          color: 'white',
                          textTransform: 'capitalize'
                        }}
                      />

                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        {skill.description}
                      </Typography>

                      {!isMobile && (
                        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                          {skill.triggers.slice(0, 3).map((trigger, i) => (
                            <Chip key={i} label={trigger} size="small" variant="outlined" />
                          ))}
                          {skill.triggers.length > 3 && (
                            <Chip label={`+${skill.triggers.length - 3} more`} size="small" variant="outlined" />
                          )}
                        </Box>
                      )}
                    </CardContent>

                    <CardActions sx={{ justifyContent: 'space-between', px: 2, pb: 2 }}>
                      <Button
                        size="small"
                        onClick={() => toggleExpanded(skill.id)}
                        endIcon={expandedSkills.has(skill.id) ? <ExpandLessIcon /> : <ExpandMoreIcon />}
                      >
                        {skill.actions.length} Actions
                      </Button>
                    </CardActions>

                    <Collapse in={expandedSkills.has(skill.id)}>
                      <Divider />
                      <List dense sx={{ px: 1 }}>
                        {skill.actions.map((action) => (
                          <ListItem key={action.id}>
                            <ListItemIcon sx={{ minWidth: 32 }}>
                              <PlayIcon fontSize="small" color="primary" />
                            </ListItemIcon>
                            <ListItemText
                              primary={action.name}
                              secondary={action.description}
                              primaryTypographyProps={{ variant: 'body2', fontWeight: 500 }}
                              secondaryTypographyProps={{ variant: 'caption' }}
                            />
                          </ListItem>
                        ))}
                      </List>
                    </Collapse>
                  </Card>
                </Grid>
              ))}
            </Grid>

            {skills.length === 0 && (
              <Alert severity="info" sx={{ mt: 2 }}>
                No skills loaded. Configure OpenClaw in AI Settings to get started.
              </Alert>
            )}
          </Box>
        )}
      </Paper>
    </Box>
  );
};
