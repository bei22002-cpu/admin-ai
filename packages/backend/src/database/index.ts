import { DataSource } from 'typeorm';
import { logger } from '../utils/logger';
import { User } from './entities/User';
import { ApiKey } from './entities/ApiKey';
import { Widget } from './entities/Widget';
import { CrudPage } from './entities/CrudPage';
import { CrudData } from './entities/CrudData';
import { AISettings } from './entities/AISettings';
import { ErrorLog } from './entities/ErrorLog';
import { SystemMetrics } from './entities/SystemMetrics';
import { SecurityEvent } from './entities/SecurityEvent';
import { OpenClawSkillEntity } from './entities/OpenClawSkill';
import { OpenClawConversation } from './entities/OpenClawConversation';
import { Organization } from './entities/Organization';
import { InitialMigration1709123456789 } from './migrations/1709123456789-InitialMigration';
import { AddAISettings1709123456790 } from './migrations/1709123456790-AddAISettings';
import { AddCrudData1709123456791 } from './migrations/1709123456791-AddCrudData';
import { AddSystemMetricsAndErrorLog1709123456792 } from './migrations/1709123456792-AddSystemMetricsAndErrorLog';
import { AddDefaultUser1709123456793 } from './migrations/1709123456793-AddDefaultUser';
import { FixAISettingsTypes1709123456794 } from './migrations/1709123456794-FixAISettingsTypes';
import { AddErrorLogs1709123456796 } from './migrations/1709123456796-AddErrorLogs';
import { AddSecurityEvents1709123456797 } from './migrations/1709123456797-AddSecurityEvents';
import { AddSampleData1709123456798 } from './migrations/1709123456798-AddSampleData';
import { AddMetadataToSystemMetrics1740686972345 } from './migrations/1740686972345-AddMetadataToSystemMetrics';
import { AddTypeAndValueToSystemMetrics1740686972346 } from './migrations/1740686972346-AddTypeAndValueToSystemMetrics';
import { AddOpenClawTables1742751600000 } from './migrations/1742751600000-AddOpenClawTables';
import { AddOrganization1742751600001 } from './migrations/1742751600001-AddOrganization';

// Log database configuration before initializing
logger.info('Database configuration:', {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  database: process.env.DB_DATABASE || 'admin_ai'
});

export const AppDataSource = new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_DATABASE || 'admin_ai',
  synchronize: false, // Set to false since we're using migrations
  logging: process.env.NODE_ENV !== 'production',
  entities: [User, ApiKey, Widget, CrudPage, CrudData, AISettings, ErrorLog, SystemMetrics, SecurityEvent, OpenClawSkillEntity, OpenClawConversation, Organization],
  migrations: [
    InitialMigration1709123456789,
    AddAISettings1709123456790,
    AddCrudData1709123456791,
    AddSystemMetricsAndErrorLog1709123456792,
    AddDefaultUser1709123456793,
    FixAISettingsTypes1709123456794,
    AddErrorLogs1709123456796,
    AddSecurityEvents1709123456797,
    AddSampleData1709123456798,
    AddMetadataToSystemMetrics1740686972345,
    AddTypeAndValueToSystemMetrics1740686972346,
    AddOpenClawTables1742751600000,
    AddOrganization1742751600001
  ],
  subscribers: [],
});

export const setupDatabase = async () => {
  try {
    // If already initialized, test the connection
    if (AppDataSource.isInitialized) {
      try {
        await AppDataSource.query('SELECT 1');
        logger.info('Database connection already initialized and working');
        return AppDataSource;
      } catch (error) {
        logger.warn('Existing database connection failed, destroying...');
        await AppDataSource.destroy();
      }
    }

    // Initialize the connection
    await AppDataSource.initialize();
    logger.info('Database connection initialized');

    // Verify connection
    await AppDataSource.query('SELECT 1');
    logger.info('Database connection verified');

    // Run migrations
    const pendingMigrations = await AppDataSource.showMigrations();
    if (pendingMigrations) {
      logger.info('Running pending migrations...');
      await AppDataSource.runMigrations();
      logger.info('Migrations completed successfully');
    }

    return AppDataSource;
  } catch (error) {
    logger.error('Error during database initialization:', error);
    throw error;
  }
};
