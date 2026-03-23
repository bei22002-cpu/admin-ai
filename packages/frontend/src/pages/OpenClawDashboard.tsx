import React, { useEffect, useState, useCallback } from 'react';
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
  IconButton,
  Collapse,
  Paper
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
  Circle as CircleIcon
} from '@mui/icons-material';
import { useAuth } from '../contexts/AuthContext';
import { useSnackbar } from '../contexts/SnackbarContext';
import { openClawService, OpenClawSkill, OpenClawStatus } from '../services/openclaw.service';
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

export const OpenClawDashboard: React.FC = () => {
  const { user } = useAuth();
  const { showSuccess, showError } = useSnackbar();
  const [skills, setSkills] = useState<OpenClawSkill[]>([]);
  const [status, setStatus] = useState<OpenClawStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSkills, setExpandedSkills] = useState<Set<string>>(new Set());
  const [messageDialogOpen, setMessageDialogOpen] = useState(false);
  const [messageContent, setMessageContent] = useState('');
  const [messageResponse, setMessageResponse] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      const [skillsData, statusData] = await Promise.all([
        openClawService.getSkills(),
        openClawService.getStatus()
      ]);
      setSkills(skillsData);
      setStatus(statusData);
    } catch (error) {
      logger.error('Failed to load OpenClaw data:', error);
      // Load default state if API fails (service not initialized yet)
      setSkills([]);
      setStatus({
        connected: false,
        gatewayUrl: '',
        activeSkills: 0,
        totalSkills: 0,
        channels: []
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (user) {
      void loadData();
    }
  }, [user, loadData]);

  const handleToggleSkill = useCallback(async (skillId: string, enabled: boolean) => {
    try {
      await openClawService.toggleSkill(skillId, enabled);
      setSkills(prev => prev.map(s => s.id === skillId ? { ...s, enabled } : s));
      showSuccess(`Skill ${enabled ? 'enabled' : 'disabled'} successfully`);
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
    if (!messageContent.trim()) return;

    try {
      setSendingMessage(true);
      const response = await openClawService.sendMessage(messageContent);
      setMessageResponse(response);
    } catch (error) {
      logger.error('Failed to send message:', error);
      setMessageResponse('Error: Failed to send message to OpenClaw');
    } finally {
      setSendingMessage(false);
    }
  }, [messageContent]);

  if (!user) {
    return (
      <Box sx={{ p: 3 }}>
        <Alert severity="warning">Please log in to access OpenClaw settings</Alert>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box sx={{ display: 'flex', justifyContent: 'center', p: 3 }}>
        <CircularProgress />
      </Box>
    );
  }

  return (
    <Box sx={{ p: 3 }}>
      {/* Header */}
      <Box sx={{ display: 'flex', alignItems: 'center', mb: 3 }}>
        <Typography variant="h4" sx={{ mr: 2 }}>
          OpenClaw Assistant
        </Typography>
        <Chip
          icon={<CircleIcon sx={{ fontSize: 12 }} />}
          label={status?.connected ? 'Connected' : 'Not Connected'}
          color={status?.connected ? 'success' : 'default'}
          size="small"
        />
      </Box>

      <Typography variant="body1" sx={{ mb: 3 }}>
        Your personal AI assistant with business-building skills. Configure skills below to automate website building,
        content creation, social media, email outreach, analytics, and invoicing.
      </Typography>

      {/* Status Overview */}
      <Paper sx={{ p: 2, mb: 3, bgcolor: 'background.default' }}>
        <Grid container spacing={2}>
          <Grid item xs={12} sm={3}>
            <Typography variant="overline" color="text.secondary">Gateway</Typography>
            <Typography variant="body2" noWrap>
              {status?.gatewayUrl || 'Not configured'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={3}>
            <Typography variant="overline" color="text.secondary">Active Skills</Typography>
            <Typography variant="h6">
              {status?.activeSkills ?? 0} / {status?.totalSkills ?? 0}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={3}>
            <Typography variant="overline" color="text.secondary">Last Heartbeat</Typography>
            <Typography variant="body2">
              {status?.lastHeartbeat ? new Date(status.lastHeartbeat).toLocaleString() : 'Never'}
            </Typography>
          </Grid>
          <Grid item xs={12} sm={3}>
            <Typography variant="overline" color="text.secondary">Channels</Typography>
            <Typography variant="body2">
              {status?.channels?.length ? status.channels.join(', ') : 'None configured'}
            </Typography>
          </Grid>
        </Grid>
      </Paper>

      {/* Quick Actions */}
      <Box sx={{ mb: 3 }}>
        <Button
          variant="contained"
          onClick={() => setMessageDialogOpen(true)}
          sx={{ mr: 1 }}
        >
          Send Message to OpenClaw
        </Button>
        <Button
          variant="outlined"
          onClick={loadData}
        >
          Refresh Status
        </Button>
      </Box>

      <Divider sx={{ mb: 3 }} />

      {/* Skills Grid */}
      <Typography variant="h5" gutterBottom>
        Business Skills
      </Typography>

      <Grid container spacing={3}>
        {skills.map((skill) => (
          <Grid item xs={12} md={6} lg={4} key={skill.id}>
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
                    <Typography variant="h6" component="div">
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

                <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, mt: 1 }}>
                  {skill.triggers.slice(0, 3).map((trigger, i) => (
                    <Chip key={i} label={trigger} size="small" variant="outlined" />
                  ))}
                  {skill.triggers.length > 3 && (
                    <Chip label={`+${skill.triggers.length - 3} more`} size="small" variant="outlined" />
                  )}
                </Box>
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

      {/* Message Dialog */}
      <Dialog
        open={messageDialogOpen}
        onClose={() => {
          setMessageDialogOpen(false);
          setMessageResponse('');
          setMessageContent('');
        }}
        maxWidth="md"
        fullWidth
      >
        <DialogTitle>Send Message to OpenClaw</DialogTitle>
        <DialogContent>
          <TextField
            autoFocus
            margin="dense"
            label="Message"
            fullWidth
            multiline
            rows={3}
            value={messageContent}
            onChange={(e) => setMessageContent(e.target.value)}
            placeholder="e.g., Build me a landing page for my consulting business..."
          />
          {messageResponse && (
            <Paper sx={{ mt: 2, p: 2, bgcolor: 'background.default' }}>
              <Typography variant="subtitle2" gutterBottom>Response:</Typography>
              <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                {messageResponse}
              </Typography>
            </Paper>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => {
            setMessageDialogOpen(false);
            setMessageResponse('');
            setMessageContent('');
          }}>
            Close
          </Button>
          <Button
            onClick={handleSendMessage}
            variant="contained"
            disabled={sendingMessage || !messageContent.trim()}
          >
            {sendingMessage ? <CircularProgress size={20} /> : 'Send'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};
