output "ec2_ip" {
  value = aws_instance.minecraft.public_ip
}

output "s3_bucket" {
  value = var.minecraft_s3_bucket != null ? var.minecraft_s3_bucket : aws_s3_bucket.minecraft_saves[0].bucket
}

output "motd" {
  value = var.motd
}

output "max_players" {
  value = var.max_players
}
