provider "aws" {
  region = "us-east-1"
}

data "aws_vpc" "default" {
  default = true
}

resource "aws_security_group" "minecraft_sg" {
  name_prefix = "minecraft-"
  description = "Allow SSH and Minecraft access"
  vpc_id      = data.aws_vpc.default.id

  ingress {
    from_port   = 22
    to_port     = 22
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"] # Open for now — restrict later for security
  }

  ingress {
    from_port   = 25565
    to_port     = 25565
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

resource "aws_instance" "minecraft" {
  ami           = "ami-0c02fb55956c7d316" # Amazon Linux 2
  instance_type = var.instance_type # Blueprint option for users to select size (t3.medium is default)
  key_name      = "minesible-access"
  vpc_security_group_ids = [aws_security_group.minecraft_sg.id]
  iam_instance_profile = aws_iam_instance_profile.ec2_profile.name

  tags = {
    Name = "MinecraftServer"
  }

  user_data = <<EOF
#!/bin/bash
yum update -y
yum install -y python3
EOF
}

resource "aws_s3_bucket" "minecraft_saves" {

  # Logic here to use provided TF_var "minecraft_s3_bucket" - if none provided, use "minesible-world-backups-${random_id.bucket_id.hex}"
  # "minesible-world-backups-${random_id.bucket_id.hex}" will be destoryed on infra teardown so it's recommend to save your files to a pre-created S3 bucket

  bucket = var.minecraft_s3_bucket != null ? var.minecraft_s3_bucket : "minesible-world-backups-${random_id.bucket_id.hex}"
  force_destroy = true

  # Only create if we're not passing one as a variable
  count = var.minecraft_s3_bucket == null ? 1 : 0
}

resource "random_id" "bucket_id" {
  byte_length = 4
}

resource "aws_iam_role" "ec2_s3_access" {
  name = "ec2-minecraft-s3-access"

  assume_role_policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Principal = {
          Service = "ec2.amazonaws.com"
        },
        Action = "sts:AssumeRole"
      }
    ]
  })
}

resource "aws_iam_role_policy" "s3_policy" {
  name = "ec2-s3-full-access"
  role = aws_iam_role.ec2_s3_access.id

  policy = jsonencode({
    Version = "2012-10-17",
    Statement = [
      {
        Effect = "Allow",
        Action = [
          "s3:ListAllMyBuckets"
        ],
        Resource = "*"
      },
      {
        Effect = "Allow",
        Action = [
          "s3:ListBucket",
          "s3:GetObject",
          "s3:PutObject",
          "s3:DeleteObject",
          "s3:DeleteObjectVersion"
        ],
        Resource = [
          "arn:aws:s3:::*",
          "arn:aws:s3:::*/*"
        ]
      }
    ]
  })
}

resource "aws_iam_instance_profile" "ec2_profile" {
  name = "minecraft-ec2-profile"
  role = aws_iam_role.ec2_s3_access.name
}
