# 🪓 Minesible

**Minesible** is a scalable, on-demand **Minecraft server deployment** using **OpenTofu + Ansible + Spacelift**.  
Spin up your own Minecraft server in minutes, with **persistent world saves to S3** even after infra teardown.

---

## 🚀 Features

✅ Deploy Minecraft servers on demand  
✅ Automated configuration with Ansible  
✅ Persist world saves to S3 buckets (passed as a TF_VAR 'TF_VAR_minecraft_s3_bucket' into spacelift)
✅ Uses Spacelift stack dependencies for clean IaC orchestration  

Coming soon:
- Self-service ready for customer blueprints  
- Supports scheduled world backups (using scheduling via private workers)

---

## 🛠️ How it works

1. **Opentofu Stack (`Stacks/Opentofu/`)**
   - Provisions an EC2 instance with IAM roles and a random or provided S3 bucket for saves.
   - Uses OpenTofu (Terraform-compatible) to manage infrastructure declaratively.

2. **Ansible Stack (`Stacks/Ansible/`)**
   - Configures the EC2 instance as a Minecraft server with Ansible.
   - Syncs world save files from S3 at startup and uploads periodic backups.

3. **Save Scheduling**
   - Uses Spacelift scheduling to run Ansible tasks for world backups hourly.

4. **Destroy Safety**
   - Before destroying infra, world saves are zipped and uploaded to your backup bucket to avoid progress loss.

---

## 📦 Repository Structure

minesible/
├── stacks/
│   ├── ansible/      # Ansible playbooks and inventory templates
│   └── opentofu/     # OpenTofu (Terraform) infrastructure code
└── README.md

---

## 📝 Usage

1. Fork or clone this repo:
   > [github.com/spacelift-solutions/minesible](https://github.com/spacelift-solutions/minesible/)
2. Update `infra/variables.tf` if you want to pass a pre-created bucket name.
3. Create two Spacelift stacks:
   - **Infra stack** (OpenTofu) with your AWS integration context.
   - **Config stack** (Ansible) with SSH key context and stack dependency on the infra stack.
4. Adjust stack-specific custom hooks or scheduling as needed.
5. Run the infra stack to deploy.
6. Config stack will auto run to configure your server and sync world saves.

---

### ✨ Future Ideas

- Self-service ready for customer blueprints  
- Supports scheduled world backups (using scheduling via private workers)
- Region-specific variable (eg. options like us-east2)
- Instance type variable (eg. options like t2.micro)
- Automatic Discord status notifications

---

Happy mining! ⛏️

Built with ❤️ by to showcase the power of IaC automation.

---
