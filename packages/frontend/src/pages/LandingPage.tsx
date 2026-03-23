import React from 'react';
import {
  Box,
  Typography,
  Button,
  Container,
  Grid,
  Card,
  CardContent,
  Chip,
  Paper,
  useMediaQuery,
  useTheme,
} from '@mui/material';
import {
  Code as CodeIcon,
  Article as ArticleIcon,
  Share as ShareIcon,
  Email as EmailIcon,
  BarChart as BarChartIcon,
  Receipt as ReceiptIcon,
  Speed as SpeedIcon,
  Security as SecurityIcon,
  Cloud as CloudIcon,
  ArrowForward as ArrowForwardIcon,
  SmartToy as AIIcon,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';

const skills = [
  { icon: <CodeIcon />, name: 'Website Builder', description: 'Build and deploy landing pages through natural language commands', color: '#2196f3' },
  { icon: <ArticleIcon />, name: 'Content Creation', description: 'Generate blog posts, marketing copy, and SEO-optimized content', color: '#9c27b0' },
  { icon: <ShareIcon />, name: 'Social Media', description: 'Create, schedule, and manage posts across all platforms', color: '#e91e63' },
  { icon: <EmailIcon />, name: 'Email Outreach', description: 'Draft personalized campaigns, newsletters, and sequences', color: '#ff9800' },
  { icon: <BarChartIcon />, name: 'Business Analytics', description: 'Track KPIs, generate reports, and identify trends', color: '#4caf50' },
  { icon: <ReceiptIcon />, name: 'Invoice & Billing', description: 'Generate invoices, track payments, send reminders', color: '#607d8b' },
];

const features = [
  { icon: <SpeedIcon />, title: 'Real-Time Dashboard', description: 'Monitor your business metrics, system health, and AI activity in real-time with WebSocket-powered updates.' },
  { icon: <AIIcon />, title: 'OpenClaw AI Assistant', description: 'Your always-on personal AI assistant with persistent memory, business skills, and multi-channel access.' },
  { icon: <SecurityIcon />, title: 'Secure & Private', description: 'Self-hosted on your infrastructure. Your data stays yours. Role-based access control and JWT authentication.' },
  { icon: <CloudIcon />, title: 'One-Click Deploy', description: 'Get up and running in minutes with Docker Compose. Works on any cloud provider or local machine.' },
];

export const LandingPage: React.FC = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const theme = useTheme();
  const isMobile = useMediaQuery(theme.breakpoints.down('sm'));

  // Redirect to dashboard if already logged in
  if (user) {
    navigate('/dashboard');
    return null;
  }

  return (
    <Box sx={{ minHeight: '100vh', bgcolor: 'background.default' }}>
      {/* Hero Section */}
      <Box
        sx={{
          background: 'linear-gradient(135deg, #1a237e 0%, #0d47a1 50%, #01579b 100%)',
          color: 'white',
          py: isMobile ? 8 : 12,
          px: 2,
        }}
      >
        <Container maxWidth="lg">
          <Grid container spacing={4} alignItems="center">
            <Grid item xs={12} md={7}>
              <Chip label="Open Source" color="success" size="small" sx={{ mb: 2 }} />
              <Typography variant={isMobile ? 'h3' : 'h2'} fontWeight={800} gutterBottom>
                Your AI-Powered Business Operating System
              </Typography>
              <Typography variant="h6" sx={{ opacity: 0.9, mb: 4, maxWidth: 600 }}>
                AdminAI + OpenClaw combines a real-time admin dashboard with an always-on AI assistant
                that builds websites, creates content, manages emails, and runs your business 24/7.
              </Typography>
              <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                <Button
                  variant="contained"
                  size="large"
                  onClick={() => navigate('/register')}
                  endIcon={<ArrowForwardIcon />}
                  sx={{
                    bgcolor: 'white',
                    color: '#1a237e',
                    fontWeight: 700,
                    px: 4,
                    '&:hover': { bgcolor: '#f5f5f5' }
                  }}
                >
                  Get Started Free
                </Button>
                <Button
                  variant="outlined"
                  size="large"
                  onClick={() => navigate('/login')}
                  sx={{
                    borderColor: 'rgba(255,255,255,0.5)',
                    color: 'white',
                    px: 4,
                    '&:hover': { borderColor: 'white', bgcolor: 'rgba(255,255,255,0.1)' }
                  }}
                >
                  Sign In
                </Button>
              </Box>
            </Grid>
            <Grid item xs={12} md={5}>
              <Paper
                elevation={8}
                sx={{
                  p: 3,
                  borderRadius: 3,
                  bgcolor: 'rgba(255,255,255,0.1)',
                  backdropFilter: 'blur(10px)',
                  border: '1px solid rgba(255,255,255,0.2)',
                }}
              >
                <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.7)', mb: 1 }}>
                  Try asking OpenClaw:
                </Typography>
                {[
                  '"Build me a landing page for my consulting business"',
                  '"Write a blog post about AI automation"',
                  '"Create an invoice for $5,000 for web development"',
                  '"Draft a cold email campaign for SaaS founders"',
                  '"Show me my business analytics dashboard"',
                ].map((prompt, i) => (
                  <Box
                    key={i}
                    sx={{
                      p: 1.5,
                      mb: 1,
                      borderRadius: 1,
                      bgcolor: 'rgba(255,255,255,0.08)',
                      '&:hover': { bgcolor: 'rgba(255,255,255,0.15)' },
                      cursor: 'pointer',
                      transition: 'all 0.2s',
                    }}
                  >
                    <Typography variant="body2" sx={{ color: 'white', fontStyle: 'italic' }}>
                      {prompt}
                    </Typography>
                  </Box>
                ))}
              </Paper>
            </Grid>
          </Grid>
        </Container>
      </Box>

      {/* Skills Section */}
      <Container maxWidth="lg" sx={{ py: isMobile ? 6 : 10 }}>
        <Typography variant="h4" fontWeight={700} textAlign="center" gutterBottom>
          6 Business-Building Skills
        </Typography>
        <Typography variant="body1" textAlign="center" color="text.secondary" sx={{ mb: 6, maxWidth: 600, mx: 'auto' }}>
          Each skill is a specialized AI module that understands your business context and takes real actions — not just chat.
        </Typography>
        <Grid container spacing={3}>
          {skills.map((skill) => (
            <Grid item xs={12} sm={6} md={4} key={skill.name}>
              <Card
                sx={{
                  height: '100%',
                  borderLeft: `4px solid ${skill.color}`,
                  transition: 'transform 0.2s, box-shadow 0.2s',
                  '&:hover': { transform: 'translateY(-4px)', boxShadow: 6 },
                }}
              >
                <CardContent>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, mb: 1.5 }}>
                    <Box sx={{ color: skill.color }}>{skill.icon}</Box>
                    <Typography variant="h6" fontWeight={600}>{skill.name}</Typography>
                  </Box>
                  <Typography variant="body2" color="text.secondary">
                    {skill.description}
                  </Typography>
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      </Container>

      {/* Features Section */}
      <Box sx={{ bgcolor: 'background.paper', py: isMobile ? 6 : 10 }}>
        <Container maxWidth="lg">
          <Typography variant="h4" fontWeight={700} textAlign="center" gutterBottom>
            Built for Serious Builders
          </Typography>
          <Typography variant="body1" textAlign="center" color="text.secondary" sx={{ mb: 6, maxWidth: 600, mx: 'auto' }}>
            Not another chatbot wrapper. AdminAI is a full-stack admin platform with real-time monitoring, CRUD generation, and AI automation.
          </Typography>
          <Grid container spacing={4}>
            {features.map((feature) => (
              <Grid item xs={12} sm={6} key={feature.title}>
                <Box sx={{ display: 'flex', gap: 2, alignItems: 'flex-start' }}>
                  <Box sx={{ color: 'primary.main', mt: 0.5 }}>{feature.icon}</Box>
                  <Box>
                    <Typography variant="h6" fontWeight={600} gutterBottom>
                      {feature.title}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      {feature.description}
                    </Typography>
                  </Box>
                </Box>
              </Grid>
            ))}
          </Grid>
        </Container>
      </Box>

      {/* Deploy Section */}
      <Container maxWidth="lg" sx={{ py: isMobile ? 6 : 10 }}>
        <Paper
          sx={{
            p: isMobile ? 3 : 5,
            textAlign: 'center',
            borderRadius: 3,
            background: 'linear-gradient(135deg, #f5f5f5 0%, #e8eaf6 100%)',
          }}
        >
          <Typography variant="h4" fontWeight={700} gutterBottom>
            Deploy in 60 Seconds
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ mb: 3 }}>
            One command. Everything you need.
          </Typography>
          <Paper
            sx={{
              p: 2,
              maxWidth: 600,
              mx: 'auto',
              mb: 3,
              bgcolor: '#1e1e1e',
              borderRadius: 2,
            }}
          >
            <Typography
              variant="body1"
              sx={{
                fontFamily: 'monospace',
                color: '#4caf50',
                textAlign: 'left',
              }}
            >
              $ git clone https://github.com/bei22002-cpu/admin-ai.git<br />
              $ cd admin-ai<br />
              $ docker compose up -d<br />
              <span style={{ color: '#90caf9' }}># Open http://localhost:3000</span>
            </Typography>
          </Paper>
          <Button
            variant="contained"
            size="large"
            onClick={() => navigate('/register')}
            endIcon={<ArrowForwardIcon />}
            sx={{ px: 4, fontWeight: 700 }}
          >
            Start Building Your Business
          </Button>
        </Paper>
      </Container>

      {/* Footer */}
      <Box sx={{ bgcolor: '#1a237e', color: 'white', py: 4, px: 2 }}>
        <Container maxWidth="lg">
          <Grid container spacing={4}>
            <Grid item xs={12} sm={4}>
              <Typography variant="h6" gutterBottom fontWeight={700}>
                AdminAI
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>
                Open-source AI-powered admin dashboard with OpenClaw personal assistant integration.
              </Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="subtitle1" gutterBottom fontWeight={600}>
                Product
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7, mb: 0.5 }}>Dashboard</Typography>
              <Typography variant="body2" sx={{ opacity: 0.7, mb: 0.5 }}>OpenClaw Skills</Typography>
              <Typography variant="body2" sx={{ opacity: 0.7, mb: 0.5 }}>API Documentation</Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>Deployment Guide</Typography>
            </Grid>
            <Grid item xs={12} sm={4}>
              <Typography variant="subtitle1" gutterBottom fontWeight={600}>
                Resources
              </Typography>
              <Typography
                variant="body2"
                component="a"
                href="https://github.com/bei22002-cpu/admin-ai"
                sx={{ opacity: 0.7, color: 'white', display: 'block', mb: 0.5, textDecoration: 'none', '&:hover': { opacity: 1 } }}
              >
                GitHub Repository
              </Typography>
              <Typography variant="body2" sx={{ opacity: 0.7, mb: 0.5 }}>Documentation</Typography>
              <Typography variant="body2" sx={{ opacity: 0.7 }}>Community</Typography>
            </Grid>
          </Grid>
          <Typography variant="body2" textAlign="center" sx={{ opacity: 0.5, mt: 4 }}>
            {new Date().getFullYear()} AdminAI. Open source under MIT License.
          </Typography>
        </Container>
      </Box>
    </Box>
  );
};
