<template>
  <div>
    <q-dialog v-model="showEditDialog" @hide="closeDialog">
      <q-card style="width: 600px; max-width: 90vw">
        <q-card-section class="q-pb-sm">
          <div class="text-body1">编辑元数据</div>
        </q-card-section>

        <q-card-section class="q-pt-none scroll" style="max-height: 60vh">
          <!-- Title -->
          <q-input
            v-model="editable.title"
            label="标题"
            filled
            class="q-mb-md"
          />

          <!-- NSFW toggle -->
          <div class="q-mb-md">
            <q-toggle v-model="editable.nsfw" label="R18" />
          </div>

          <!-- Circle -->
          <q-input
            v-model="editable.circle"
            label="社团名称"
            filled
            class="q-mb-md"
          />

          <!-- Tags -->
          <div class="q-mb-md">
            <div class="text-subtitle2 q-mb-xs">标签</div>
            <div class="q-gutter-xs q-mb-xs">
              <q-chip
                v-for="(tag, idx) in editable.tags"
                :key="'tag-' + idx"
                removable
                @remove="removeTag(idx)"
              >
                {{ tag.name }}
              </q-chip>
            </div>
            <q-select
              v-model="tagInput"
              use-input
              input-debounce="300"
              label="添加标签"
              filled
              dense
              clearable
              @new-value="addTag"
              @update:model-value="addTag"
              @filter="filterTags"
              :options="tagOptions"
              option-label="name"
              option-value="name"
              emit-value
              map-options
              style="max-width: 400px"
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    输入后按回车创建
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <!-- VAs -->
          <div class="q-mb-md">
            <div class="text-subtitle2 q-mb-xs">声优</div>
            <div class="q-gutter-xs q-mb-xs">
              <q-chip
                v-for="(va, idx) in editable.vas"
                :key="'va-' + idx"
                removable
                @remove="removeVa(idx)"
              >
                {{ va.name }}
              </q-chip>
            </div>
            <q-select
              v-model="vaInput"
              use-input
              input-debounce="300"
              label="添加声优"
              filled
              dense
              clearable
              @new-value="addVa"
              @update:model-value="addVa"
              @filter="filterVas"
              :options="vaOptions"
              option-label="name"
              option-value="name"
              emit-value
              map-options
              style="max-width: 400px"
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    输入后按回车创建
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <!-- Illustrators -->
          <div class="q-mb-md">
            <div class="text-subtitle2 q-mb-xs">イラスト</div>
            <div class="q-gutter-xs q-mb-xs">
              <q-chip
                v-for="(illus, idx) in editable.illustrators"
                :key="'illus-' + idx"
                removable
                @remove="removeIllustrator(idx)"
              >
                {{ illus.name }}
              </q-chip>
            </div>
            <q-select
              v-model="illustratorInput"
              use-input
              input-debounce="300"
              label="添加イラスト"
              filled
              dense
              clearable
              @new-value="addIllustrator"
              @update:model-value="addIllustrator"
              @filter="filterIllustrators"
              :options="illustratorOptions"
              option-label="name"
              option-value="name"
              emit-value
              map-options
              style="max-width: 400px"
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    输入后按回车创建
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <!-- Script Writers -->
          <div class="q-mb-md">
            <div class="text-subtitle2 q-mb-xs">シナリオ</div>
            <div class="q-gutter-xs q-mb-xs">
              <q-chip
                v-for="(sw, idx) in editable.scriptWriters"
                :key="'sw-' + idx"
                removable
                @remove="removeScriptWriter(idx)"
              >
                {{ sw.name }}
              </q-chip>
            </div>
            <q-select
              v-model="scriptWriterInput"
              use-input
              input-debounce="300"
              label="添加シナリオ"
              filled
              dense
              clearable
              @new-value="addScriptWriter"
              @update:model-value="addScriptWriter"
              @filter="filterScriptWriters"
              :options="scriptWriterOptions"
              option-label="name"
              option-value="name"
              emit-value
              map-options
              style="max-width: 400px"
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    输入后按回车创建
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>

          <!-- Series -->
          <div class="q-mb-md">
            <div class="text-subtitle2 q-mb-xs">系列</div>
            <q-select
              v-model="editable.series"
              use-input
              input-debounce="300"
              label="选择系列 (可清空)"
              filled
              dense
              clearable
              @filter="filterSeries"
              :options="seriesOptions"
              option-label="name"
              style="max-width: 400px"
            >
              <template v-slot:no-option>
                <q-item>
                  <q-item-section class="text-grey">
                    无匹配系列
                  </q-item-section>
                </q-item>
              </template>
            </q-select>
          </div>
        </q-card-section>

        <div class="row justify-between">
          <q-card-actions align="left">
            <q-btn flat label="取消" @click="closeDialog()" />
          </q-card-actions>
          <q-card-actions align="right" class="text-primary">
            <q-btn flat label="保存" :loading="saving" @click="submitEdit()" />
          </q-card-actions>
        </div>
      </q-card>
    </q-dialog>
  </div>
</template>

<script>
import NotifyMixin from '../mixins/Notification.js'

export default {
  name: 'EditMetadata',

  mixins: [NotifyMixin],

  props: {
    metadata: {
      type: Object,
      required: true
    }
  },

  data() {
    return {
      showEditDialog: true,
      saving: false,
      editable: {
        title: '',
        nsfw: false,
        circle: '',
        tags: [],
        vas: [],
        illustrators: [],
        scriptWriters: [],
        series: null
      },
      tagInput: null,
      tagOptions: [],
      vaInput: null,
      vaOptions: [],
      illustratorInput: null,
      illustratorOptions: [],
      scriptWriterInput: null,
      scriptWriterOptions: [],
      seriesInput: null,
      seriesOptions: []
    }
  },

  mounted() {
    if (this.metadata) {
      this.editable.title = this.metadata.title || '';
      this.editable.nsfw = Boolean(this.metadata.nsfw);
      this.editable.circle = this.metadata.circle ? this.metadata.circle.name : '';
      this.editable.tags = (this.metadata.tags || []).map(t => ({ id: t.id, name: t.name }));
      this.editable.vas = (this.metadata.vas || []).map(v => ({ id: v.id, name: v.name }));
      this.editable.illustrators = (this.metadata.illustrators || []).map(i => ({ id: i.id, name: i.name }));
      this.editable.scriptWriters = (this.metadata.scriptWriters || []).map(s => ({ id: s.id, name: s.name }));
      this.editable.series = this.metadata.series ? { id: this.metadata.series.id, name: this.metadata.series.name } : null;
    }
  },

  methods: {
    closeDialog() {
      this.$emit('closed');
    },

    async fetchOptions(endpoint) {
      try {
        const response = await this.$axios.get(endpoint);
        return response.data || [];
      } catch (err) {
        console.error('Failed to fetch ' + endpoint, err);
        return [];
      }
    },

    async filterTags(val, update) {
      const options = await this.fetchOptions('/api/tags');
      update(() => {
        this.tagOptions = val ? options.filter(o => o.name.toLowerCase().includes(val.toLowerCase())) : options;
      });
    },

    addTag(val) {
      const name = (val || '').trim();
      if (!name) return;
      if (this.editable.tags.some(t => t.name === name)) return;
      this.editable.tags.push({ name });
      this.tagInput = null;
    },

    removeTag(idx) {
      this.editable.tags.splice(idx, 1);
    },

    async filterVas(val, update) {
      const options = await this.fetchOptions('/api/vas');
      update(() => {
        this.vaOptions = val ? options.filter(o => o.name.toLowerCase().includes(val.toLowerCase())) : options;
      });
    },

    addVa(val) {
      const name = (val || '').trim();
      if (!name) return;
      if (this.editable.vas.some(v => v.name === name)) return;
      this.editable.vas.push({ name });
      this.vaInput = null;
    },

    removeVa(idx) {
      this.editable.vas.splice(idx, 1);
    },

    async filterIllustrators(val, update) {
      const options = await this.fetchOptions('/api/illustrators');
      update(() => {
        this.illustratorOptions = val ? options.filter(o => o.name.toLowerCase().includes(val.toLowerCase())) : options;
      });
    },

    addIllustrator(val) {
      const name = (val || '').trim();
      if (!name) return;
      if (this.editable.illustrators.some(i => i.name === name)) return;
      this.editable.illustrators.push({ name });
      this.illustratorInput = null;
    },

    removeIllustrator(idx) {
      this.editable.illustrators.splice(idx, 1);
    },

    async filterScriptWriters(val, update) {
      const options = await this.fetchOptions('/api/script_writers');
      update(() => {
        this.scriptWriterOptions = val ? options.filter(o => o.name.toLowerCase().includes(val.toLowerCase())) : options;
      });
    },

    addScriptWriter(val) {
      const name = (val || '').trim();
      if (!name) return;
      if (this.editable.scriptWriters.some(s => s.name === name)) return;
      this.editable.scriptWriters.push({ name });
      this.scriptWriterInput = null;
    },

    removeScriptWriter(idx) {
      this.editable.scriptWriters.splice(idx, 1);
    },

    async filterSeries(val, update) {
      const options = await this.fetchOptions('/api/seriess');
      update(() => {
        this.seriesOptions = val ? options.filter(o => o.name.toLowerCase().includes(val.toLowerCase())) : options;
      });
    },

    submitEdit() {
      const payload = {
        title: this.editable.title,
        nsfw: this.editable.nsfw,
        release: this.metadata.release || '',
        circle: this.editable.circle,
        tags: this.editable.tags.map(t => ({ name: t.name })),
        vas: this.editable.vas.map(v => ({ name: v.name })),
        illustrators: this.editable.illustrators.map(i => ({ name: i.name })),
        scriptWriters: this.editable.scriptWriters.map(s => ({ name: s.name })),
        series: this.editable.series ? { name: this.editable.series.name } : null
      };

      this.saving = true;
      this.$axios.put(`/api/work/${this.metadata.id}`, payload)
        .then((response) => {
          this.showSuccNotif(response.data.message || '元数据更新成功');
          this.$emit('saved');
        })
        .catch((error) => {
          if (error.response) {
            this.showErrNotif(error.response.data.error || `${error.response.status} ${error.response.statusText}`);
          } else {
            this.showErrNotif(error.message || error);
          }
        })
        .finally(() => {
          this.saving = false;
        });
    }
  }
}
</script>

<style lang="sass" scoped>
.scroll
  overflow-y: auto
</style>