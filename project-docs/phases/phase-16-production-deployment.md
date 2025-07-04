# Phase 16: Production Deployment

## 🎯 Phase Overview
This phase takes the dockerized AI Media Search application from Phase 15 to production. We'll implement two deployment options: AWS for scale and VPS for budget-conscious deployments. We'll secure the infrastructure, optimize the database, configure production environments, and establish deployment procedures.

## ✅ Prerequisites
- All phases 1-15 completed and tested
- Docker images built and tested from Phase 15
- Domain name registered and DNS access
- Cloud provider account (AWS) or VPS provider account
- SSL certificates ready (Let's Encrypt)
- Production API keys for all services
- Backup storage configured (S3 or B2)

## 📋 Phase Checklist
- [ ] Choose and configure infrastructure (AWS or VPS)
- [ ] Implement security hardening
- [ ] Configure production database with backups
- [ ] Set up production environment variables
- [ ] Configure domain and SSL certificates
- [ ] Deploy application with zero downtime
- [ ] Verify all services are operational
- [ ] Establish disaster recovery procedures

---

## Step 1: Infrastructure Setup - Option A (AWS)

### 1.1 Create AWS Infrastructure with Terraform
Create `deployment/production/infrastructure/aws/terraform/main.tf`:

```hcl
terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
  
  backend "s3" {
    bucket = "ai-media-search-terraform-state"
    key    = "production/terraform.tfstate"
    region = "us-east-1"
  }
}

provider "aws" {
  region = var.aws_region
}

# Variables
variable "aws_region" {
  default = "us-east-1"
}

variable "environment" {
  default = "production"
}

variable "app_name" {
  default = "ai-media-search"
}

# VPC Configuration
module "vpc" {
  source = "terraform-aws-modules/vpc/aws"
  
  name = "${var.app_name}-${var.environment}-vpc"
  cidr = "10.0.0.0/16"
  
  azs             = ["${var.aws_region}a", "${var.aws_region}b", "${var.aws_region}c"]
  private_subnets = ["10.0.1.0/24", "10.0.2.0/24", "10.0.3.0/24"]
  public_subnets  = ["10.0.101.0/24", "10.0.102.0/24", "10.0.103.0/24"]
  
  enable_nat_gateway = true
  enable_vpn_gateway = true
  enable_dns_hostnames = true
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}

# Security Groups
resource "aws_security_group" "alb" {
  name_prefix = "${var.app_name}-alb-"
  vpc_id      = module.vpc.vpc_id
  
  ingress {
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  ingress {
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_security_group" "app" {
  name_prefix = "${var.app_name}-app-"
  vpc_id      = module.vpc.vpc_id
  
  ingress {
    from_port       = 3000
    to_port         = 3000
    protocol        = "tcp"
    security_groups = [aws_security_group.alb.id]
  }
  
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# RDS PostgreSQL with pgvector
resource "aws_db_subnet_group" "postgres" {
  name       = "${var.app_name}-${var.environment}-db-subnet"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_db_parameter_group" "postgres" {
  name   = "${var.app_name}-${var.environment}-pg15"
  family = "postgres15"
  
  parameter {
    name  = "shared_preload_libraries"
    value = "pg_stat_statements,pgvector"
  }
}

resource "aws_db_instance" "postgres" {
  identifier = "${var.app_name}-${var.environment}-db"
  
  engine               = "postgres"
  engine_version       = "15.4"
  instance_class       = "db.r6g.large"
  allocated_storage    = 100
  storage_type         = "gp3"
  storage_encrypted    = true
  
  db_name  = "ai_media_search"
  username = "aimediadmin"
  password = var.db_password # Store in AWS Secrets Manager
  
  vpc_security_group_ids = [aws_security_group.rds.id]
  db_subnet_group_name   = aws_db_subnet_group.postgres.name
  parameter_group_name   = aws_db_parameter_group.postgres.name
  
  backup_retention_period = 30
  backup_window          = "03:00-04:00"
  maintenance_window     = "sun:04:00-sun:05:00"
  
  enabled_cloudwatch_logs_exports = ["postgresql"]
  
  deletion_protection = true
  skip_final_snapshot = false
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}

# ElastiCache Redis Cluster
resource "aws_elasticache_subnet_group" "redis" {
  name       = "${var.app_name}-${var.environment}-redis-subnet"
  subnet_ids = module.vpc.private_subnets
}

resource "aws_elasticache_replication_group" "redis" {
  replication_group_id = "${var.app_name}-${var.environment}-redis"
  description          = "Redis cluster for ${var.app_name}"
  
  engine               = "redis"
  engine_version       = "7.0"
  node_type           = "cache.r6g.large"
  num_cache_clusters  = 3
  parameter_group_name = "default.redis7.cluster.on"
  
  subnet_group_name = aws_elasticache_subnet_group.redis.name
  security_group_ids = [aws_security_group.redis.id]
  
  at_rest_encryption_enabled = true
  transit_encryption_enabled = true
  auth_token_enabled        = true
  auth_token                = var.redis_auth_token # Store in AWS Secrets Manager
  
  automatic_failover_enabled = true
  multi_az_enabled          = true
  
  snapshot_retention_limit = 7
  snapshot_window         = "03:00-05:00"
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}

# ECS Cluster for Application
resource "aws_ecs_cluster" "main" {
  name = "${var.app_name}-${var.environment}"
  
  setting {
    name  = "containerInsights"
    value = "enabled"
  }
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}

# Application Load Balancer
resource "aws_lb" "main" {
  name               = "${var.app_name}-${var.environment}-alb"
  internal           = false
  load_balancer_type = "application"
  security_groups    = [aws_security_group.alb.id]
  subnets           = module.vpc.public_subnets
  
  enable_deletion_protection = true
  enable_http2              = true
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}

# S3 Buckets
resource "aws_s3_bucket" "media" {
  bucket = "${var.app_name}-${var.environment}-media"
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}

resource "aws_s3_bucket_versioning" "media" {
  bucket = aws_s3_bucket.media.id
  
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "media" {
  bucket = aws_s3_bucket.media.id
  
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "AES256"
    }
  }
}

# CloudFront Distribution
resource "aws_cloudfront_distribution" "media" {
  origin {
    domain_name = aws_s3_bucket.media.bucket_regional_domain_name
    origin_id   = "S3-${aws_s3_bucket.media.id}"
    
    s3_origin_config {
      origin_access_identity = aws_cloudfront_origin_access_identity.media.cloudfront_access_identity_path
    }
  }
  
  enabled             = true
  is_ipv6_enabled    = true
  default_root_object = "index.html"
  
  default_cache_behavior {
    allowed_methods  = ["GET", "HEAD", "OPTIONS"]
    cached_methods   = ["GET", "HEAD"]
    target_origin_id = "S3-${aws_s3_bucket.media.id}"
    
    forwarded_values {
      query_string = false
      cookies {
        forward = "none"
      }
    }
    
    viewer_protocol_policy = "redirect-to-https"
    min_ttl                = 0
    default_ttl            = 86400
    max_ttl                = 31536000
  }
  
  price_class = "PriceClass_100"
  
  restrictions {
    geo_restriction {
      restriction_type = "none"
    }
  }
  
  viewer_certificate {
    cloudfront_default_certificate = true
  }
  
  tags = {
    Environment = var.environment
    Application = var.app_name
  }
}
```

### 1.2 Deploy AWS Infrastructure
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
cd deployment/production/infrastructure/aws/terraform

# Initialize Terraform
terraform init

# Plan deployment
terraform plan -out=tfplan

# Apply infrastructure
terraform apply tfplan

# Save outputs
terraform output -json > ../outputs.json
```

### 1.3 Create ECS Task Definitions
Create `deployment/production/infrastructure/aws/ecs-task-definition.json`:

```json
{
  "family": "ai-media-search-app",
  "networkMode": "awsvpc",
  "requiresCompatibilities": ["FARGATE"],
  "cpu": "2048",
  "memory": "4096",
  "taskRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ai-media-search-task-role",
  "executionRoleArn": "arn:aws:iam::ACCOUNT_ID:role/ai-media-search-execution-role",
  "containerDefinitions": [
    {
      "name": "app",
      "image": "REGISTRY_URL/ai-media-search-app:latest",
      "essential": true,
      "portMappings": [
        {
          "containerPort": 3000,
          "protocol": "tcp"
        }
      ],
      "environment": [
        {
          "name": "NODE_ENV",
          "value": "production"
        },
        {
          "name": "PORT",
          "value": "3000"
        }
      ],
      "secrets": [
        {
          "name": "DATABASE_URL",
          "valueFrom": "arn:aws:secretsmanager:region:ACCOUNT_ID:secret:ai-media-search/database-url"
        },
        {
          "name": "REDIS_URL",
          "valueFrom": "arn:aws:secretsmanager:region:ACCOUNT_ID:secret:ai-media-search/redis-url"
        },
        {
          "name": "NEXTAUTH_SECRET",
          "valueFrom": "arn:aws:secretsmanager:region:ACCOUNT_ID:secret:ai-media-search/nextauth-secret"
        }
      ],
      "logConfiguration": {
        "logDriver": "awslogs",
        "options": {
          "awslogs-group": "/ecs/ai-media-search-app",
          "awslogs-region": "us-east-1",
          "awslogs-stream-prefix": "app"
        }
      },
      "healthCheck": {
        "command": ["CMD-SHELL", "curl -f http://localhost:3000/api/health || exit 1"],
        "interval": 30,
        "timeout": 5,
        "retries": 3,
        "startPeriod": 60
      }
    }
  ]
}
```

---

## Step 2: Infrastructure Setup - Option B (VPS)

### 2.1 Create VPS Setup Script
Create `deployment/production/infrastructure/vps/setup.sh`:

```bash
#!/bin/bash
set -e

# VPS Production Setup Script for AI Media Search
# Tested on Ubuntu 22.04 LTS

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Configuration
DOMAIN="example.com"
EMAIL="admin@example.com"
APP_USER="aimediadeploy"
APP_DIR="/opt/ai-media-search"
BACKUP_DIR="/opt/backups"

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
    exit 1
}

# Check if running as root
if [[ $EUID -ne 0 ]]; then
   error "This script must be run as root"
fi

log "Starting VPS setup for AI Media Search..."

# Update system
log "Updating system packages..."
apt-get update
apt-get upgrade -y
apt-get install -y \
    curl \
    wget \
    git \
    vim \
    htop \
    ufw \
    fail2ban \
    unattended-upgrades \
    software-properties-common \
    apt-transport-https \
    ca-certificates \
    gnupg \
    lsb-release

# Create application user
log "Creating application user..."
if ! id "$APP_USER" &>/dev/null; then
    useradd -m -s /bin/bash $APP_USER
    usermod -aG docker $APP_USER
fi

# Install Docker
log "Installing Docker..."
if ! command -v docker &> /dev/null; then
    curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /usr/share/keyrings/docker-archive-keyring.gpg
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/docker-archive-keyring.gpg] https://download.docker.com/linux/ubuntu $(lsb_release -cs) stable" | tee /etc/apt/sources.list.d/docker.list > /dev/null
    apt-get update
    apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
fi

# Configure Docker
log "Configuring Docker..."
cat > /etc/docker/daemon.json <<EOF
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "10m",
    "max-file": "3"
  },
  "metrics-addr": "127.0.0.1:9323",
  "experimental": true
}
EOF
systemctl restart docker

# Install Nginx
log "Installing Nginx..."
apt-get install -y nginx
systemctl enable nginx

# Install Certbot
log "Installing Certbot..."
snap install --classic certbot
ln -sf /snap/bin/certbot /usr/bin/certbot

# Configure UFW Firewall
log "Configuring firewall..."
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3000/tcp # Remove after Nginx is configured
ufw --force enable

# Configure Fail2ban
log "Configuring Fail2ban..."
cat > /etc/fail2ban/jail.local <<EOF
[DEFAULT]
bantime = 3600
findtime = 600
maxretry = 5

[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log

[nginx-http-auth]
enabled = true
filter = nginx-http-auth
port = http,https
logpath = /var/log/nginx/error.log

[nginx-limit-req]
enabled = true
filter = nginx-limit-req
port = http,https
logpath = /var/log/nginx/error.log
EOF
systemctl restart fail2ban

# Configure automatic security updates
log "Configuring automatic security updates..."
cat > /etc/apt/apt.conf.d/50unattended-upgrades <<EOF
Unattended-Upgrade::Allowed-Origins {
    "\${distro_id}:\${distro_codename}-security";
    "\${distro_id}ESMApps:\${distro_codename}-apps-security";
    "\${distro_id}ESM:\${distro_codename}-infra-security";
};
Unattended-Upgrade::AutoFixInterruptedDpkg "true";
Unattended-Upgrade::MinimalSteps "true";
Unattended-Upgrade::Remove-Unused-Dependencies "true";
Unattended-Upgrade::Automatic-Reboot "false";
Unattended-Upgrade::Automatic-Reboot-Time "03:00";
EOF

# Create application directories
log "Creating application directories..."
mkdir -p $APP_DIR/{app,data,logs,configs,scripts}
mkdir -p $BACKUP_DIR/{db,media,configs}
chown -R $APP_USER:$APP_USER $APP_DIR
chown -R $APP_USER:$APP_USER $BACKUP_DIR

# Install PostgreSQL client for backups
log "Installing PostgreSQL client..."
apt-get install -y postgresql-client

# Configure system limits
log "Configuring system limits..."
cat >> /etc/security/limits.conf <<EOF
* soft nofile 65536
* hard nofile 65536
* soft nproc 32768
* hard nproc 32768
EOF

# Configure sysctl for production
log "Optimizing kernel parameters..."
cat > /etc/sysctl.d/99-ai-media-search.conf <<EOF
# Network optimizations
net.core.somaxconn = 65535
net.ipv4.tcp_max_syn_backlog = 65535
net.ipv4.ip_local_port_range = 1024 65535
net.ipv4.tcp_tw_reuse = 1
net.ipv4.tcp_fin_timeout = 30
net.core.netdev_max_backlog = 65535

# VM optimizations
vm.swappiness = 10
vm.dirty_ratio = 15
vm.dirty_background_ratio = 5
EOF
sysctl -p /etc/sysctl.d/99-ai-media-search.conf

# Set up swap
log "Configuring swap..."
if ! swapon --show | grep -q swap; then
    fallocate -l 4G /swapfile
    chmod 600 /swapfile
    mkswap /swapfile
    swapon /swapfile
    echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# Install monitoring tools
log "Installing monitoring tools..."
wget -q -O - https://packages.grafana.com/gpg.key | apt-key add -
add-apt-repository "deb https://packages.grafana.com/oss/deb stable main"
apt-get update
apt-get install -y prometheus node-exporter

# Create deployment script
log "Creating deployment script..."
cat > $APP_DIR/scripts/deploy.sh <<'EOF'
#!/bin/bash
set -e

COMPOSE_FILE="/opt/ai-media-search/docker-compose.prod.yml"
ENV_FILE="/opt/ai-media-search/.env.production"

# Load environment
export $(grep -v '^#' $ENV_FILE | xargs)

# Pull latest images
docker-compose -f $COMPOSE_FILE pull

# Run database migrations
docker-compose -f $COMPOSE_FILE run --rm app npm run db:migrate:prod

# Deploy with zero downtime
docker-compose -f $COMPOSE_FILE up -d --scale app=4 --no-recreate
sleep 30
docker-compose -f $COMPOSE_FILE up -d --scale app=2 --no-recreate

# Cleanup
docker system prune -f
EOF
chmod +x $APP_DIR/scripts/deploy.sh
chown $APP_USER:$APP_USER $APP_DIR/scripts/deploy.sh

log "VPS setup completed successfully!"
log "Next steps:"
log "1. Configure DNS to point to this server"
log "2. Copy docker-compose.prod.yml to $APP_DIR"
log "3. Create .env.production with all secrets"
log "4. Run certbot to obtain SSL certificates"
log "5. Configure Nginx reverse proxy"
```

### 2.2 Create Production Docker Compose for VPS
Create `deployment/production/infrastructure/vps/docker-compose.prod.yml`:

```yaml
version: '3.9'

services:
  postgres:
    image: postgres:15-alpine
    container_name: ai-media-search-postgres
    restart: always
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./configs/postgresql.conf:/etc/postgresql/postgresql.conf:ro
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/01-init.sql:ro
    environment:
      POSTGRES_USER: ${DB_USER}
      POSTGRES_PASSWORD: ${DB_PASSWORD}
      POSTGRES_DB: ${DB_NAME}
      POSTGRES_INITDB_ARGS: "--encoding=UTF8 --locale=en_US.UTF-8"
    command: postgres -c config_file=/etc/postgresql/postgresql.conf
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${DB_USER} -d ${DB_NAME}"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - internal

  pgbouncer:
    image: pgbouncer/pgbouncer:latest
    container_name: ai-media-search-pgbouncer
    restart: always
    volumes:
      - ./configs/pgbouncer.ini:/etc/pgbouncer/pgbouncer.ini:ro
      - ./configs/userlist.txt:/etc/pgbouncer/userlist.txt:ro
    networks:
      - internal
    depends_on:
      postgres:
        condition: service_healthy

  redis:
    image: redis:7-alpine
    container_name: ai-media-search-redis
    restart: always
    command: redis-server /usr/local/etc/redis/redis.conf
    volumes:
      - redis_data:/data
      - ./configs/redis.conf:/usr/local/etc/redis/redis.conf:ro
    healthcheck:
      test: ["CMD", "redis-cli", "--raw", "incr", "ping"]
      interval: 30s
      timeout: 5s
      retries: 3
    networks:
      - internal

  app:
    image: ghcr.io/${GITHUB_REPOSITORY}/ai-media-search-app:${VERSION}
    container_name: ai-media-search-app
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@pgbouncer:6432/${DB_NAME}
      REDIS_URL: redis://redis:6379
      NEXTAUTH_URL: https://${DOMAIN}
      NEXTAUTH_SECRET: ${NEXTAUTH_SECRET}
      FIREBASE_SERVICE_ACCOUNT: ${FIREBASE_SERVICE_ACCOUNT}
      STRIPE_SECRET_KEY: ${STRIPE_SECRET_KEY}
      STRIPE_WEBHOOK_SECRET: ${STRIPE_WEBHOOK_SECRET}
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      AWS_REGION: ${AWS_REGION}
      S3_BUCKET_NAME: ${S3_BUCKET_NAME}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      pgbouncer:
        condition: service_started
      redis:
        condition: service_healthy
    networks:
      - internal
      - external
    deploy:
      replicas: 2
      resources:
        limits:
          cpus: '2'
          memory: 2G
        reservations:
          cpus: '1'
          memory: 1G

  workers:
    image: ghcr.io/${GITHUB_REPOSITORY}/ai-media-search-workers:${VERSION}
    container_name: ai-media-search-workers
    restart: always
    environment:
      NODE_ENV: production
      DATABASE_URL: postgresql://${DB_USER}:${DB_PASSWORD}@pgbouncer:6432/${DB_NAME}
      REDIS_URL: redis://redis:6379
      AWS_ACCESS_KEY_ID: ${AWS_ACCESS_KEY_ID}
      AWS_SECRET_ACCESS_KEY: ${AWS_SECRET_ACCESS_KEY}
      AWS_REGION: ${AWS_REGION}
      S3_BUCKET_NAME: ${S3_BUCKET_NAME}
      OPENAI_API_KEY: ${OPENAI_API_KEY}
    depends_on:
      pgbouncer:
        condition: service_started
      redis:
        condition: service_healthy
    networks:
      - internal
    deploy:
      resources:
        limits:
          cpus: '4'
          memory: 4G
        reservations:
          cpus: '2'
          memory: 2G

  prometheus:
    image: prom/prometheus:latest
    container_name: ai-media-search-prometheus
    restart: always
    volumes:
      - ./configs/prometheus.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/usr/share/prometheus/console_libraries'
      - '--web.console.templates=/usr/share/prometheus/consoles'
    networks:
      - internal
    ports:
      - "127.0.0.1:9090:9090"

  grafana:
    image: grafana/grafana:latest
    container_name: ai-media-search-grafana
    restart: always
    environment:
      GF_SECURITY_ADMIN_PASSWORD: ${GRAFANA_PASSWORD}
      GF_SERVER_ROOT_URL: https://${DOMAIN}/grafana/
      GF_SERVER_SERVE_FROM_SUB_PATH: true
    volumes:
      - grafana_data:/var/lib/grafana
      - ./configs/grafana-datasources.yml:/etc/grafana/provisioning/datasources/datasources.yml:ro
      - ./configs/grafana-dashboards.yml:/etc/grafana/provisioning/dashboards/dashboards.yml:ro
      - ./dashboards:/var/lib/grafana/dashboards:ro
    networks:
      - internal
    depends_on:
      - prometheus

  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    container_name: ai-media-search-postgres-exporter
    restart: always
    environment:
      DATA_SOURCE_NAME: postgresql://${DB_USER}:${DB_PASSWORD}@postgres:5432/${DB_NAME}?sslmode=disable
    networks:
      - internal
    depends_on:
      postgres:
        condition: service_healthy

  redis-exporter:
    image: oliver006/redis_exporter:latest
    container_name: ai-media-search-redis-exporter
    restart: always
    environment:
      REDIS_ADDR: redis://redis:6379
    networks:
      - internal
    depends_on:
      redis:
        condition: service_healthy

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:

networks:
  internal:
    driver: bridge
    internal: true
  external:
    driver: bridge
```

---

## Step 3: Security Hardening

### 3.1 Configure Production PostgreSQL
Create `deployment/production/configs/postgresql.conf`:

```conf
# PostgreSQL Production Configuration
# Optimized for 8GB RAM VPS or equivalent

# Connections
max_connections = 200
superuser_reserved_connections = 3

# Memory
shared_buffers = 2GB
effective_cache_size = 6GB
maintenance_work_mem = 512MB
work_mem = 10MB
wal_buffers = 16MB

# Checkpoints
checkpoint_segments = 32
checkpoint_completion_target = 0.9
wal_keep_segments = 32

# Query Planner
random_page_cost = 1.1
effective_io_concurrency = 200
default_statistics_target = 100

# Logging
log_destination = 'stderr'
logging_collector = on
log_directory = 'pg_log'
log_filename = 'postgresql-%Y-%m-%d_%H%M%S.log'
log_rotation_age = 1d
log_rotation_size = 1GB
log_min_duration_statement = 100
log_checkpoints = on
log_connections = on
log_disconnections = on
log_lock_waits = on
log_temp_files = 0
log_autovacuum_min_duration = 0
log_line_prefix = '%t [%p]: [%l-1] user=%u,db=%d,app=%a,client=%h '

# Security
ssl = on
ssl_cert_file = '/etc/ssl/certs/ssl-cert-snakeoil.pem'
ssl_key_file = '/etc/ssl/private/ssl-cert-snakeoil.key'
password_encryption = scram-sha-256

# Replication
wal_level = replica
archive_mode = on
archive_command = 'test ! -f /backup/archive/%f && cp %p /backup/archive/%f'
max_wal_senders = 3
wal_keep_segments = 64
hot_standby = on

# Extensions
shared_preload_libraries = 'pg_stat_statements,pgvector'
```

### 3.2 Configure Redis Security
Create `deployment/production/configs/redis.conf`:

```conf
# Redis Production Configuration

# Network
bind 0.0.0.0
protected-mode yes
port 6379
timeout 300
tcp-keepalive 60
tcp-backlog 511

# Security
requirepass REDIS_PASSWORD_PLACEHOLDER
maxclients 10000

# Memory
maxmemory 2gb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Persistence
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /data

# AOF
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes
aof-use-rdb-preamble yes

# Logging
loglevel notice
logfile ""
syslog-enabled no

# Slow log
slowlog-log-slower-than 10000
slowlog-max-len 128

# Advanced
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
hll-sparse-max-bytes 3000
stream-node-max-bytes 4096
stream-node-max-entries 100
activerehashing yes
client-output-buffer-limit normal 0 0 0
client-output-buffer-limit replica 256mb 64mb 60
client-output-buffer-limit pubsub 32mb 8mb 60
hz 10
dynamic-hz yes
aof-rewrite-incremental-fsync yes
rdb-save-incremental-fsync yes
```

### 3.3 Configure Nginx with SSL
Create `deployment/production/configs/nginx.conf`:

```nginx
# Nginx Production Configuration

user nginx;
worker_processes auto;
worker_rlimit_nofile 65535;
error_log /var/log/nginx/error.log warn;
pid /var/run/nginx.pid;

events {
    worker_connections 4096;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main_json escape=json
        '{'
            '"time_local":"$time_local",'
            '"remote_addr":"$remote_addr",'
            '"remote_user":"$remote_user",'
            '"request":"$request",'
            '"status": "$status",'
            '"body_bytes_sent":"$body_bytes_sent",'
            '"request_time":"$request_time",'
            '"http_referrer":"$http_referer",'
            '"http_user_agent":"$http_user_agent",'
            '"http_x_forwarded_for":"$http_x_forwarded_for",'
            '"upstream_response_time":"$upstream_response_time",'
            '"upstream_connect_time":"$upstream_connect_time",'
            '"upstream_header_time":"$upstream_header_time"'
        '}';

    access_log /var/log/nginx/access.log main_json;

    # Basic Settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    server_tokens off;
    client_max_body_size 100M;
    client_body_buffer_size 128k;
    client_header_buffer_size 1k;
    large_client_header_buffers 4 16k;

    # SSL Settings
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-ECDSA-AES128-GCM-SHA256:ECDHE-RSA-AES128-GCM-SHA256:ECDHE-ECDSA-AES256-GCM-SHA384:ECDHE-RSA-AES256-GCM-SHA384:ECDHE-ECDSA-CHACHA20-POLY1305:ECDHE-RSA-CHACHA20-POLY1305:DHE-RSA-AES128-GCM-SHA256:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_timeout 1d;
    ssl_session_cache shared:SSL:10m;
    ssl_session_tickets off;
    ssl_stapling on;
    ssl_stapling_verify on;

    # Gzip Settings
    gzip on;
    gzip_vary on;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types text/plain text/css text/xml text/javascript application/json application/javascript application/xml+rss application/rss+xml application/atom+xml image/svg+xml;

    # Security Headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self' https:; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' https:; connect-src 'self' https: wss:; media-src 'self' https:; object-src 'none'; frame-ancestors 'self'; base-uri 'self'; form-action 'self' https:;" always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=()" always;

    # Rate Limiting
    limit_req_zone $binary_remote_addr zone=general:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=api:10m rate=20r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/s;
    limit_req_zone $binary_remote_addr zone=upload:10m rate=2r/s;
    limit_conn_zone $binary_remote_addr zone=addr:10m;

    # Upstream Configuration
    upstream app_backend {
        least_conn;
        server app:3000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    # Include site configurations
    include /etc/nginx/conf.d/*.conf;
}
```

### 3.4 Create SSL Configuration Script
Create `deployment/production/scripts/ssl-setup.sh`:

```bash
#!/bin/bash
set -e

DOMAIN="$1"
EMAIL="$2"

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
    echo "Usage: $0 <domain> <email>"
    exit 1
fi

# Install certbot if not present
if ! command -v certbot &> /dev/null; then
    snap install --classic certbot
    ln -sf /snap/bin/certbot /usr/bin/certbot
fi

# Obtain certificate
certbot certonly \
    --nginx \
    --non-interactive \
    --agree-tos \
    --email "$EMAIL" \
    --domains "$DOMAIN,www.$DOMAIN" \
    --expand

# Create Nginx SSL configuration
cat > /etc/nginx/conf.d/ai-media-search-ssl.conf <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN www.$DOMAIN;
    
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN www.$DOMAIN;
    
    # SSL Configuration
    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    ssl_trusted_certificate /etc/letsencrypt/live/$DOMAIN/chain.pem;
    
    # HSTS
    add_header Strict-Transport-Security "max-age=63072000; includeSubDomains; preload" always;
    
    # Locations
    location / {
        limit_req zone=general burst=20 nodelay;
        limit_conn addr 10;
        
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        
        proxy_connect_timeout 60s;
        proxy_send_timeout 60s;
        proxy_read_timeout 60s;
    }
    
    location /api/ {
        limit_req zone=api burst=40 nodelay;
        
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        proxy_buffering off;
        proxy_cache off;
    }
    
    location /api/auth/ {
        limit_req zone=auth burst=10 nodelay;
        
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
    
    location /api/upload/ {
        limit_req zone=upload burst=5 nodelay;
        client_max_body_size 5G;
        
        proxy_pass http://app_backend;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        
        proxy_request_buffering off;
    }
    
    # Static files
    location /_next/static/ {
        proxy_pass http://app_backend;
        proxy_cache static_cache;
        proxy_cache_valid 200 60m;
        proxy_cache_use_stale error timeout updating http_500 http_502 http_503 http_504;
        add_header X-Cache-Status \$upstream_cache_status;
        add_header Cache-Control "public, immutable, max-age=31536000";
    }
    
    # Health check
    location /health {
        access_log off;
        proxy_pass http://app_backend/api/health;
    }
    
    # Monitoring
    location /grafana/ {
        auth_basic "Monitoring Access";
        auth_basic_user_file /etc/nginx/.htpasswd;
        
        proxy_pass http://grafana:3000/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}

# Cache configuration
proxy_cache_path /var/cache/nginx/static levels=1:2 keys_zone=static_cache:10m max_size=1g inactive=60m use_temp_path=off;
EOF

# Test and reload Nginx
nginx -t && systemctl reload nginx

# Set up auto-renewal
cat > /etc/systemd/system/certbot-renewal.service <<EOF
[Unit]
Description=Certbot Renewal
After=network.target

[Service]
Type=oneshot
ExecStart=/usr/bin/certbot renew --quiet --post-hook "systemctl reload nginx"
EOF

cat > /etc/systemd/system/certbot-renewal.timer <<EOF
[Unit]
Description=Run Certbot Renewal twice daily

[Timer]
OnCalendar=*-*-* 00,12:00:00
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF

systemctl daemon-reload
systemctl enable --now certbot-renewal.timer

echo "SSL setup completed for $DOMAIN"
```

---

## Step 4: Database Production Setup

### 4.1 Create Database Backup Script
Create `deployment/production/scripts/backup.sh`:

```bash
#!/bin/bash
set -e

# Database Backup Script
# Run daily via cron

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ai_media_search}"
DB_USER="${DB_USER:-aimediadmin}"
BACKUP_DIR="/opt/backups/db"
S3_BUCKET="${BACKUP_S3_BUCKET:-ai-media-search-backups}"
RETENTION_DAYS=30

# Logging
LOG_FILE="/var/log/ai-media-search/backup.log"
log() {
    echo "[$(date +'%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Generate backup filename
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/ai_media_search_${TIMESTAMP}.sql.gz"

log "Starting database backup..."

# Perform backup
export PGPASSWORD="$DB_PASSWORD"
pg_dump \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --verbose \
    --no-owner \
    --no-privileges \
    --format=custom \
    --compress=9 \
    --file="$BACKUP_FILE.tmp"

# Verify backup
if [ ! -f "$BACKUP_FILE.tmp" ]; then
    log "ERROR: Backup failed - file not created"
    exit 1
fi

# Compress and encrypt
log "Compressing and encrypting backup..."
gzip -c "$BACKUP_FILE.tmp" | openssl enc -aes-256-cbc -salt -k "$BACKUP_ENCRYPTION_KEY" > "$BACKUP_FILE"
rm -f "$BACKUP_FILE.tmp"

# Upload to S3
log "Uploading to S3..."
aws s3 cp "$BACKUP_FILE" "s3://$S3_BUCKET/database/" \
    --storage-class STANDARD_IA \
    --metadata "timestamp=$TIMESTAMP,hostname=$(hostname)"

# Verify upload
if aws s3 ls "s3://$S3_BUCKET/database/$(basename $BACKUP_FILE)" > /dev/null 2>&1; then
    log "Upload successful"
    # Remove local copy after successful upload
    rm -f "$BACKUP_FILE"
else
    log "ERROR: Upload failed"
    exit 1
fi

# Clean up old backups in S3
log "Cleaning up old backups..."
aws s3 ls "s3://$S3_BUCKET/database/" | while read -r line; do
    createDate=$(echo $line | awk '{print $1" "$2}')
    createDate=$(date -d "$createDate" +%s)
    olderThan=$(date -d "$RETENTION_DAYS days ago" +%s)
    if [[ $createDate -lt $olderThan ]]; then
        fileName=$(echo $line | awk '{print $4}')
        if [[ $fileName != "" ]]; then
            aws s3 rm "s3://$S3_BUCKET/database/$fileName"
            log "Deleted old backup: $fileName"
        fi
    fi
done

# Test restore capability (monthly)
if [ "$(date +%d)" = "01" ]; then
    log "Running monthly restore test..."
    TEST_DB="ai_media_search_restore_test"
    
    # Download latest backup
    LATEST_BACKUP=$(aws s3 ls "s3://$S3_BUCKET/database/" | sort | tail -n 1 | awk '{print $4}')
    aws s3 cp "s3://$S3_BUCKET/database/$LATEST_BACKUP" "/tmp/$LATEST_BACKUP"
    
    # Decrypt and restore to test database
    openssl enc -d -aes-256-cbc -k "$BACKUP_ENCRYPTION_KEY" -in "/tmp/$LATEST_BACKUP" | \
        gunzip -c | \
        pg_restore -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d postgres --create --clean --if-exists
    
    # Verify restore
    if psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$TEST_DB" -c "SELECT COUNT(*) FROM users;" > /dev/null 2>&1; then
        log "Restore test successful"
        # Drop test database
        dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$TEST_DB"
    else
        log "ERROR: Restore test failed"
    fi
    
    rm -f "/tmp/$LATEST_BACKUP"
fi

log "Backup completed successfully"

# Send notification
if [ -n "$SLACK_WEBHOOK" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"Database backup completed successfully for $DB_NAME\"}" \
        "$SLACK_WEBHOOK" > /dev/null 2>&1
fi
```

### 4.2 Create Database Restore Script
Create `deployment/production/scripts/restore.sh`:

```bash
#!/bin/bash
set -e

# Database Restore Script

# Configuration
DB_HOST="${DB_HOST:-localhost}"
DB_PORT="${DB_PORT:-5432}"
DB_NAME="${DB_NAME:-ai_media_search}"
DB_USER="${DB_USER:-aimediadmin}"
S3_BUCKET="${BACKUP_S3_BUCKET:-ai-media-search-backups}"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Check if backup file is provided
BACKUP_FILE="$1"
if [ -z "$BACKUP_FILE" ]; then
    # List available backups
    echo "Available backups:"
    aws s3 ls "s3://$S3_BUCKET/database/" | sort -r | head -20
    echo
    echo "Usage: $0 <backup-file-name>"
    echo "Example: $0 ai_media_search_20240101_120000.sql.gz"
    exit 1
fi

warning "This will restore the database from backup: $BACKUP_FILE"
warning "Current database will be DROPPED and REPLACED!"
read -p "Are you SURE you want to continue? Type 'yes' to proceed: " -r
if [[ ! $REPLY == "yes" ]]; then
    log "Restore cancelled"
    exit 0
fi

# Create restore directory
RESTORE_DIR="/tmp/db-restore-$$"
mkdir -p "$RESTORE_DIR"
cd "$RESTORE_DIR"

# Download backup
log "Downloading backup from S3..."
if ! aws s3 cp "s3://$S3_BUCKET/database/$BACKUP_FILE" "$BACKUP_FILE"; then
    error "Failed to download backup file"
    exit 1
fi

# Decrypt and decompress
log "Decrypting and decompressing backup..."
openssl enc -d -aes-256-cbc -k "$BACKUP_ENCRYPTION_KEY" -in "$BACKUP_FILE" | gunzip -c > "${BACKUP_FILE%.gz}"

# Stop application
log "Stopping application..."
docker-compose -f /opt/ai-media-search/docker-compose.prod.yml stop app workers

# Take emergency backup of current database
log "Creating emergency backup of current database..."
EMERGENCY_BACKUP="/opt/backups/emergency/emergency_$(date +%Y%m%d_%H%M%S).sql.gz"
mkdir -p "$(dirname $EMERGENCY_BACKUP)"
export PGPASSWORD="$DB_PASSWORD"
pg_dump -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" | gzip > "$EMERGENCY_BACKUP"

# Drop and recreate database
log "Dropping existing database..."
dropdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" --if-exists "$DB_NAME"
createdb -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" "$DB_NAME"

# Enable extensions
log "Enabling database extensions..."
psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" <<EOF
CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
EOF

# Restore database
log "Restoring database..."
pg_restore \
    -h "$DB_HOST" \
    -p "$DB_PORT" \
    -U "$DB_USER" \
    -d "$DB_NAME" \
    --verbose \
    --no-owner \
    --no-privileges \
    --exit-on-error \
    "${BACKUP_FILE%.gz}"

# Verify restore
log "Verifying restore..."
TABLES=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public';")
USERS=$(psql -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER" -d "$DB_NAME" -t -c "SELECT COUNT(*) FROM users;")

log "Restored $TABLES tables"
log "Found $USERS users"

# Run migrations to ensure schema is up to date
log "Running database migrations..."
docker-compose -f /opt/ai-media-search/docker-compose.prod.yml run --rm app npm run db:migrate:prod

# Restart application
log "Starting application..."
docker-compose -f /opt/ai-media-search/docker-compose.prod.yml up -d

# Cleanup
rm -rf "$RESTORE_DIR"

log "Database restore completed successfully!"
log "Emergency backup saved at: $EMERGENCY_BACKUP"

# Send notification
if [ -n "$SLACK_WEBHOOK" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"Database restored successfully from backup: $BACKUP_FILE\"}" \
        "$SLACK_WEBHOOK" > /dev/null 2>&1
fi
```

---

## Step 5: Production Environment Configuration

### 5.1 Create Production Environment File
Create `deployment/production/.env.production.template`:

```bash
# AI Media Search Production Environment Configuration
# Copy to .env.production and fill in all values

# Application
NODE_ENV=production
APP_NAME=ai-media-search
DOMAIN=example.com
APP_URL=https://example.com

# Database
DB_HOST=postgres
DB_PORT=5432
DB_NAME=ai_media_search
DB_USER=aimediadmin
DB_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
DATABASE_URL=postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:${DB_PORT}/${DB_NAME}

# Redis
REDIS_HOST=redis
REDIS_PORT=6379
REDIS_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
REDIS_URL=redis://:${REDIS_PASSWORD}@${REDIS_HOST}:${REDIS_PORT}

# Authentication
NEXTAUTH_URL=https://example.com
NEXTAUTH_SECRET=GENERATE_WITH_OPENSSL_RAND_BASE64_32

# Firebase
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----"
FIREBASE_SERVICE_ACCOUNT='{"type":"service_account",...}'

# Stripe
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PUBLISHABLE_KEY=pk_live_...

# AWS
AWS_REGION=us-east-1
AWS_ACCESS_KEY_ID=AKIA...
AWS_SECRET_ACCESS_KEY=...
S3_BUCKET_NAME=ai-media-search-production
S3_BUCKET_REGION=us-east-1

# OpenAI
OPENAI_API_KEY=sk-...
OPENAI_MODEL_EMBEDDING=text-embedding-3-small
OPENAI_MODEL_CHAT=gpt-4-turbo-preview

# Email (SendGrid)
SENDGRID_API_KEY=SG...
SENDGRID_FROM_EMAIL=noreply@example.com
SENDGRID_FROM_NAME=AI Media Search

# Monitoring
GRAFANA_PASSWORD=CHANGE_THIS_STRONG_PASSWORD
SENTRY_DSN=https://...@sentry.io/...
SENTRY_ENVIRONMENT=production

# Backup
BACKUP_ENCRYPTION_KEY=GENERATE_STRONG_KEY
BACKUP_S3_BUCKET=ai-media-search-backups

# Notifications
SLACK_WEBHOOK=https://hooks.slack.com/services/...

# Security
RATE_LIMIT_WINDOW=60000
RATE_LIMIT_MAX_REQUESTS=100
CORS_ALLOWED_ORIGINS=https://example.com,https://www.example.com

# Performance
NEXT_SHARP_PATH=/tmp/node_modules/sharp
```

### 5.2 Create Environment Validation Script
Create `deployment/production/scripts/validate-env.sh`:

```bash
#!/bin/bash
set -e

# Environment Validation Script

ENV_FILE="${1:-.env.production}"

if [ ! -f "$ENV_FILE" ]; then
    echo "Environment file not found: $ENV_FILE"
    exit 1
fi

# Required variables
REQUIRED_VARS=(
    "NODE_ENV"
    "DOMAIN"
    "DB_PASSWORD"
    "REDIS_PASSWORD"
    "NEXTAUTH_SECRET"
    "FIREBASE_SERVICE_ACCOUNT"
    "STRIPE_SECRET_KEY"
    "AWS_ACCESS_KEY_ID"
    "AWS_SECRET_ACCESS_KEY"
    "OPENAI_API_KEY"
)

# Load environment
export $(grep -v '^#' "$ENV_FILE" | xargs)

# Check required variables
MISSING_VARS=()
for var in "${REQUIRED_VARS[@]}"; do
    if [ -z "${!var}" ]; then
        MISSING_VARS+=("$var")
    fi
done

if [ ${#MISSING_VARS[@]} -ne 0 ]; then
    echo "Missing required environment variables:"
    printf '%s\n' "${MISSING_VARS[@]}"
    exit 1
fi

# Validate specific formats
if [[ ! "$DOMAIN" =~ ^[a-zA-Z0-9][a-zA-Z0-9-]{0,61}[a-zA-Z0-9]\.[a-zA-Z]{2,}$ ]]; then
    echo "Invalid domain format: $DOMAIN"
    exit 1
fi

if [ ${#NEXTAUTH_SECRET} -lt 32 ]; then
    echo "NEXTAUTH_SECRET should be at least 32 characters"
    exit 1
fi

if [[ ! "$STRIPE_SECRET_KEY" =~ ^sk_live_ ]]; then
    echo "STRIPE_SECRET_KEY should start with sk_live_ for production"
    exit 1
fi

# Test database connection
if command -v pg_isready &> /dev/null; then
    if ! pg_isready -h "$DB_HOST" -p "$DB_PORT" -U "$DB_USER"; then
        echo "Cannot connect to database"
        exit 1
    fi
fi

# Test Redis connection
if command -v redis-cli &> /dev/null; then
    if ! redis-cli -h "$REDIS_HOST" -p "$REDIS_PORT" -a "$REDIS_PASSWORD" ping > /dev/null 2>&1; then
        echo "Cannot connect to Redis"
        exit 1
    fi
fi

echo "Environment validation passed!"
```

---

## Step 6: Deployment Process

### 6.1 Create Pre-Deployment Checklist
Create `deployment/production/checklists/pre-deployment.md`:

```markdown
# Pre-Deployment Checklist

## Infrastructure
- [ ] Domain DNS configured and propagated
- [ ] SSL certificates obtained and tested
- [ ] Firewall rules configured
- [ ] SSH keys deployed
- [ ] Backup storage configured (S3/B2)

## Database
- [ ] Production database created
- [ ] pgvector extension enabled
- [ ] Database user and permissions set
- [ ] Connection pooling configured
- [ ] Backup script tested

## Security
- [ ] All default passwords changed
- [ ] Environment variables secured
- [ ] Fail2ban configured
- [ ] Security updates applied
- [ ] SSH hardened

## Services
- [ ] Docker installed and configured
- [ ] Redis password set
- [ ] Monitoring stack deployed
- [ ] Log rotation configured
- [ ] Health checks verified

## Application
- [ ] Production images built
- [ ] Environment file created
- [ ] API keys configured
- [ ] CORS settings verified
- [ ] Rate limiting tested

## Testing
- [ ] Load testing completed
- [ ] Security scan passed
- [ ] Backup/restore tested
- [ ] Monitoring alerts tested
- [ ] Rollback procedure verified
```

### 6.2 Create Deployment Script
Create `deployment/production/scripts/deploy-production.sh`:

```bash
#!/bin/bash
set -e

# Production Deployment Script

# Configuration
DEPLOY_USER="aimediadeploy"
DEPLOY_HOST="example.com"
DEPLOY_DIR="/opt/ai-media-search"
VERSION="${1:-latest}"

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

log() {
    echo -e "${GREEN}[$(date +'%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[$(date +'%Y-%m-%d %H:%M:%S')] ERROR:${NC} $1" >&2
    exit 1
}

warning() {
    echo -e "${YELLOW}[$(date +'%Y-%m-%d %H:%M:%S')] WARNING:${NC} $1"
}

# Pre-deployment checks
log "Running pre-deployment checks..."

# Check if we can connect to server
if ! ssh -o ConnectTimeout=5 "$DEPLOY_USER@$DEPLOY_HOST" "echo 'SSH connection successful'" > /dev/null 2>&1; then
    error "Cannot connect to deployment server"
fi

# Check if environment file exists
if [ ! -f ".env.production" ]; then
    error "Production environment file not found"
fi

# Validate environment
./scripts/validate-env.sh .env.production || error "Environment validation failed"

# Run security scan on images
log "Running security scan on Docker images..."
docker run --rm -v /var/run/docker.sock:/var/run/docker.sock \
    aquasec/trivy image "ghcr.io/${GITHUB_REPOSITORY}/ai-media-search-app:$VERSION" || \
    warning "Security vulnerabilities found - review before proceeding"

# Deployment confirmation
warning "You are about to deploy version $VERSION to PRODUCTION"
warning "This will affect all users!"
read -p "Type 'DEPLOY' to continue: " -r
if [[ ! $REPLY == "DEPLOY" ]]; then
    log "Deployment cancelled"
    exit 0
fi

# Create deployment package
log "Creating deployment package..."
DEPLOY_PACKAGE="deploy-${VERSION}-$(date +%Y%m%d-%H%M%S).tar.gz"
tar -czf "$DEPLOY_PACKAGE" \
    docker-compose.prod.yml \
    .env.production \
    configs/ \
    scripts/ \
    dashboards/

# Upload to server
log "Uploading deployment package..."
scp "$DEPLOY_PACKAGE" "$DEPLOY_USER@$DEPLOY_HOST:/tmp/"

# Execute deployment
log "Executing deployment on server..."
ssh "$DEPLOY_USER@$DEPLOY_HOST" << EOF
set -e

# Extract package
cd $DEPLOY_DIR
tar -xzf "/tmp/$DEPLOY_PACKAGE"
rm "/tmp/$DEPLOY_PACKAGE"

# Backup current deployment
./scripts/backup.sh

# Export version
export VERSION=$VERSION

# Pull new images
docker-compose -f docker-compose.prod.yml pull

# Run database migrations
docker-compose -f docker-compose.prod.yml run --rm app npm run db:migrate:prod

# Health check function
health_check() {
    local max_attempts=30
    local attempt=1
    
    while [ \$attempt -le \$max_attempts ]; do
        if curl -f https://$DEPLOY_HOST/api/health > /dev/null 2>&1; then
            return 0
        fi
        echo "Health check attempt \$attempt/\$max_attempts..."
        sleep 10
        ((attempt++))
    done
    
    return 1
}

# Deploy with zero downtime
docker-compose -f docker-compose.prod.yml up -d --scale app=4 --no-recreate

# Wait for new containers
sleep 30

# Check health
if ! health_check; then
    echo "Health check failed - rolling back"
    docker-compose -f docker-compose.prod.yml up -d --scale app=2
    exit 1
fi

# Scale down
docker-compose -f docker-compose.prod.yml up -d --scale app=2

# Update workers
docker-compose -f docker-compose.prod.yml up -d workers

# Clean up
docker system prune -f --volumes

echo "Deployment completed successfully!"
EOF

# Post-deployment verification
log "Running post-deployment verification..."

# Check application health
if ! curl -f "https://$DEPLOY_HOST/api/health" > /dev/null 2>&1; then
    error "Post-deployment health check failed"
fi

# Check critical services
CRITICAL_ENDPOINTS=(
    "/api/auth/session"
    "/api/media"
    "/api/search"
)

for endpoint in "${CRITICAL_ENDPOINTS[@]}"; do
    if ! curl -f "https://$DEPLOY_HOST$endpoint" -H "Authorization: Bearer test" > /dev/null 2>&1; then
        warning "Endpoint check failed: $endpoint"
    fi
done

# Clean up local package
rm -f "$DEPLOY_PACKAGE"

log "Deployment completed successfully!"
log "Version $VERSION is now live at https://$DEPLOY_HOST"

# Send notification
if [ -n "$SLACK_WEBHOOK" ]; then
    curl -X POST -H 'Content-type: application/json' \
        --data "{\"text\":\"🚀 Deployment completed: v$VERSION is now live at https://$DEPLOY_HOST\"}" \
        "$SLACK_WEBHOOK" > /dev/null 2>&1
fi
```

### 6.3 Create Smoke Test Script
Create `deployment/production/scripts/smoke-test.sh`:

```bash
#!/bin/bash
set -e

# Production Smoke Test Script

DOMAIN="${1:-example.com}"
API_KEY="${2:-$TEST_API_KEY}"

# Colors
GREEN='\033[0;32m'
RED='\033[0;31m'
NC='\033[0m'

success() {
    echo -e "${GREEN}✓${NC} $1"
}

fail() {
    echo -e "${RED}✗${NC} $1"
    FAILED=true
}

FAILED=false

echo "Running smoke tests for https://$DOMAIN..."

# Test 1: Health check
if curl -sf "https://$DOMAIN/api/health" > /dev/null; then
    success "Health check passed"
else
    fail "Health check failed"
fi

# Test 2: SSL certificate
if echo | openssl s_client -servername "$DOMAIN" -connect "$DOMAIN:443" 2>/dev/null | openssl x509 -noout -dates > /dev/null; then
    success "SSL certificate valid"
else
    fail "SSL certificate invalid"
fi

# Test 3: Static assets
if curl -sf "https://$DOMAIN/_next/static/css/" -I | grep -q "200\|304"; then
    success "Static assets accessible"
else
    fail "Static assets not accessible"
fi

# Test 4: API authentication
if curl -sf "https://$DOMAIN/api/auth/providers" | grep -q "firebase"; then
    success "Auth providers configured"
else
    fail "Auth providers not configured"
fi

# Test 5: Database connectivity
if curl -sf "https://$DOMAIN/api/health" | grep -q '"database":{"status":"healthy"'; then
    success "Database connection healthy"
else
    fail "Database connection unhealthy"
fi

# Test 6: Redis connectivity
if curl -sf "https://$DOMAIN/api/health" | grep -q '"redis":{"status":"healthy"'; then
    success "Redis connection healthy"
else
    fail "Redis connection unhealthy"
fi

# Test 7: Search functionality
if [ -n "$API_KEY" ]; then
    SEARCH_RESPONSE=$(curl -sf -X POST "https://$DOMAIN/api/search" \
        -H "Authorization: Bearer $API_KEY" \
        -H "Content-Type: application/json" \
        -d '{"query":"test"}' || echo "FAILED")
    
    if [[ "$SEARCH_RESPONSE" != "FAILED" ]] && echo "$SEARCH_RESPONSE" | grep -q "results"; then
        success "Search API functional"
    else
        fail "Search API not functional"
    fi
else
    echo "⚠ Skipping authenticated API tests (no API key provided)"
fi

# Test 8: Rate limiting
RATE_LIMIT_TEST=true
for i in {1..15}; do
    if ! curl -sf "https://$DOMAIN/api/health" > /dev/null; then
        RATE_LIMIT_TEST=false
        break
    fi
done

if [ "$RATE_LIMIT_TEST" = true ]; then
    fail "Rate limiting not working (should have been limited)"
else
    success "Rate limiting working"
fi

# Test 9: Monitoring endpoints
if curl -sf -u admin:password "https://$DOMAIN/grafana/api/health" > /dev/null 2>&1; then
    success "Monitoring accessible"
else
    echo "⚠ Monitoring not accessible (check credentials)"
fi

# Summary
echo
if [ "$FAILED" = true ]; then
    echo -e "${RED}Some tests failed!${NC}"
    exit 1
else
    echo -e "${GREEN}All tests passed!${NC}"
fi
```

---

## Testing

### Test AWS Deployment
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
# Test Terraform plan
cd deployment/production/infrastructure/aws/terraform
terraform init
terraform plan

# Validate task definition
aws ecs register-task-definition --cli-input-json file://ecs-task-definition.json --dry-run
```

### Test VPS Deployment
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
# Test setup script locally
cd deployment/production/infrastructure/vps
chmod +x setup.sh
./setup.sh --dry-run

# Test Docker Compose
docker-compose -f docker-compose.prod.yml config
```

### Test Deployment Process
```bash
connorboetig@connor:~/network_mapper$ cd ~/projects/ai-media-search
# Run pre-deployment checks
cd deployment/production
./scripts/validate-env.sh .env.production

# Test deployment script
./scripts/deploy-production.sh --dry-run

# Run smoke tests
./scripts/smoke-test.sh example.com
```

---

## Cost Comparison

### AWS Deployment Costs (Monthly Estimate)
| Service | Configuration | Monthly Cost |
|---------|--------------|-------------|
| EC2 (ECS) | 2x t3.large | $120 |
| RDS PostgreSQL | db.r6g.large | $180 |
| ElastiCache | cache.r6g.large | $140 |
| Application Load Balancer | 1 ALB | $25 |
| S3 + CloudFront | 1TB transfer | $90 |
| Data Transfer | 1TB egress | $90 |
| **Total** | | **~$645/month** |

### VPS Deployment Costs (Monthly Estimate)
| Service | Provider | Monthly Cost |
|---------|----------|-------------|
| VPS Server | Hetzner CX51 (8vCPU, 32GB) | $50 |
| Managed PostgreSQL | DigitalOcean (4GB) | $60 |
| Object Storage | Backblaze B2 (1TB) | $6 |
| Cloudflare | Pro Plan | $20 |
| Backups | S3 Standard-IA | $10 |
| **Total** | | **~$146/month** |

---

## ✅ Phase 16 Completion Checklist

### Infrastructure Setup
- [ ] **Cloud Provider**: AWS or VPS infrastructure deployed
- [ ] **Networking**: VPC, subnets, security groups configured
- [ ] **Load Balancing**: ALB or Nginx configured
- [ ] **Auto-scaling**: Configured for AWS deployment
- [ ] **Storage**: S3/B2 buckets created

### Security Implementation
- [ ] **SSL/TLS**: Certificates installed and auto-renewal configured
- [ ] **Firewall**: UFW/Security groups configured
- [ ] **SSH**: Key-based auth only, fail2ban active
- [ ] **Secrets**: All production secrets securely stored
- [ ] **Updates**: Automatic security updates enabled

### Database Production
- [ ] **Configuration**: Optimized PostgreSQL settings
- [ ] **Backups**: Automated daily backups to S3/B2
- [ ] **Monitoring**: Database metrics tracked
- [ ] **Replication**: Read replicas configured (optional)
- [ ] **Recovery**: Restore procedure tested

### Application Deployment
- [ ] **Images**: Production Docker images built
- [ ] **Environment**: Production env validated
- [ ] **Health Checks**: All services reporting healthy
- [ ] **Monitoring**: Prometheus/Grafana operational
- [ ] **Logs**: Centralized logging configured

### Verification
- [ ] **Smoke Tests**: All tests passing
- [ ] **Performance**: Load testing completed
- [ ] **Security**: Vulnerability scan passed
- [ ] **Backup**: Backup/restore verified
- [ ] **Documentation**: Runbooks created

---

## 🚀 Next Steps

**Phase 16 Complete!** ✅

**Ready for Phase 17**: Operations & Monitoring
- Read: `phases/phase-17-operations-monitoring.md`
- Prerequisites: Production deployment complete
- Outcome: Comprehensive operations and monitoring procedures