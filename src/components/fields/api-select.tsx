import backgroundImage from "../../../assets/images/screen-background/background.jpg";
import React, { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  ActivityIndicator,
  FlatList,
  Modal,
  ImageBackground,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View
} from "react-native";
import palette from "../../theme/palette";
import { createItem, getAllItems } from "../database/crud";
import { SafeAreaView } from "react-native-safe-area-context";
import models from "../database/models";

interface ISearchableSelectProps<T> {
  value?: T | null;
  onSelect?: (_: T | null) => void;
  labelKey: string;
  valueKey: keyof T;
  tableName: string;
  placeholder?: string;
  hasCreateBtn?: boolean;
  style?: {
    container?: object;
    input?: object;
  };
  pageLimit?: number;
  formik?: any;
  name?: string;
}

function SearchableSelect<T extends Record<string, unknown>>({
  value,
  onSelect,
  labelKey,
  valueKey,
  tableName,
  placeholder = "Select...",
  style = {},
  pageLimit = 10,
  hasCreateBtn = false,
  formik,
  name
}: ISearchableSelectProps<T>) {
  const { t } = useTranslation();
  const [modalVisible, setModalVisible] = useState(false);
  const [query, setQuery] = useState("");
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(false);
  const pagination = useRef({
    page: 0,
    hasMore: true,
    pending: false,
    requestId: 0
  });
  const [requestError, setRequestError] = useState("");
  const error = formik && name && formik.touched[name] && formik.errors[name];
  const selectedValue = formik && name ? formik.values[name] : value;
  const setValue = (val: T | null) => {
    if (formik && name) {
      formik.setFieldValue(name, val);
      formik.setFieldTouched(name, true);
    } else if (onSelect) {
      onSelect?.(val);
    }
  };

  const loadItems = useCallback(
    async (page = 0) => {
      if (
        page > 0 &&
        (!pagination.current.hasMore || pagination.current.pending)
      )
        return;
      const requestId = ++pagination.current.requestId;
      pagination.current.pending = true;
      setLoading(true);
      setRequestError("");
      if (page === 0) {
        pagination.current.page = 0;
        setData([]);
      }
      try {
        const result = await getAllItems<T>({
          tableName,
          filters: `lower(${labelKey}) LIKE ?`,
          parameters: [`%${query.toLowerCase()}%`],
          page,
          limit: pageLimit
        });
        if (requestId !== pagination.current.requestId) return;
        setData((previous) => (page === 0 ? result : [...previous, ...result]));
        pagination.current.page = page + 1;
        pagination.current.hasMore = result.length === pageLimit;
      } catch (error) {
        console.error("Error loading options:", error);
        if (requestId === pagination.current.requestId)
          setRequestError(t("ErrorLoadingItems"));
      } finally {
        if (requestId === pagination.current.requestId) {
          pagination.current.pending = false;
          setLoading(false);
        }
      }
    },
    [query, labelKey, tableName, pageLimit, t]
  );

  useEffect(() => {
    if (!modalVisible) return;
    const current = pagination.current;
    current.pending = true;
    setLoading(true);
    setData([]);
    const timeout = setTimeout(() => {
      void loadItems(0);
    }, 400);
    return () => {
      clearTimeout(timeout);
      current.requestId++;
      current.pending = false;
    };
  }, [modalVisible, loadItems]);

  const closeModal = () => {
    pagination.current.requestId++;
    pagination.current.pending = false;
    setModalVisible(false);
    setQuery("");
    setData([]);
    setRequestError("");
    setLoading(false);
  };

  const handleCreate = async () => {
    if (pagination.current.pending) return;
    const requestId = ++pagination.current.requestId;
    pagination.current.pending = true;
    setLoading(true);
    setRequestError("");
    try {
      const { insertId } = await createItem({
        tableName,
        data: {
          [labelKey]: query,
          ...(models[tableName]?.fields.search_text_lower && {
            search_text_lower: query.toLowerCase()
          })
        }
      });
      const [newItem] = await getAllItems<T>({
        tableName,
        filters: `${String(valueKey)} = ?`,
        parameters: [insertId],
        limit: 1
      });
      if (!newItem) throw new Error("Created record could not be loaded");
      if (requestId !== pagination.current.requestId) return;
      setValue(newItem);
      closeModal();
    } catch (error) {
      console.error("Error creating option:", error);
      if (requestId === pagination.current.requestId)
        setRequestError(t("ErrorSavingItem"));
    } finally {
      if (requestId === pagination.current.requestId) {
        pagination.current.pending = false;
        setLoading(false);
      }
    }
  };
  return (
    <View style={[styles.container, style?.container]}>
      <TouchableOpacity
        style={[styles.input, style?.input, error && styles.errorInput]}
        onPress={() => setModalVisible(true)}
      >
        <Text
          style={{
            color: selectedValue?.[labelKey]
              ? palette.glass.ink
              : palette.glass.muted
          }}
        >
          {selectedValue?.[labelKey] || placeholder}
        </Text>
      </TouchableOpacity>

      {error && <Text style={styles.error}>{error[labelKey]}</Text>}

      <Modal
        visible={modalVisible}
        animationType="slide"
        onRequestClose={closeModal}
      >
        <ImageBackground
          source={backgroundImage}
          style={styles.background}
          resizeMode="cover"
        >
          <SafeAreaView style={styles.modalContainer}>
            <TextInput
              placeholder={placeholder}
              value={query}
              onChangeText={setQuery}
              style={styles.searchInput}
              placeholderTextColor={palette.glass.muted}
            />

            <FlatList
              data={data}
              keyExtractor={(item, i) => `${item[valueKey]}-${i}`}
              renderItem={({ item }) => (
                <TouchableOpacity
                  style={styles.item}
                  onPress={() => {
                    setValue(item);
                    closeModal();
                  }}
                >
                  <Text>{String(item[labelKey] ?? "")}</Text>
                </TouchableOpacity>
              )}
              onEndReached={() => {
                if (!pagination.current.pending)
                  void loadItems(pagination.current.page);
              }}
              onEndReachedThreshold={0.5}
            />

            {loading && <ActivityIndicator style={styles.activity} />}

            {requestError && <Text style={styles.error}>{requestError}</Text>}
            {requestError && (
              <TouchableOpacity onPress={() => loadItems(0)}>
                <Text>{t("Retry")}</Text>
              </TouchableOpacity>
            )}

            {!loading &&
              !requestError &&
              query.length > 2 &&
              data.length === 0 &&
              hasCreateBtn && (
                <TouchableOpacity style={styles.create} onPress={handleCreate}>
                  <Text style={{ color: palette.colors.white }}>
                    {t("Create")}: {query}
                  </Text>
                </TouchableOpacity>
              )}

            <TouchableOpacity style={styles.closeButton} onPress={closeModal}>
              <Text>{t("Close")}</Text>
            </TouchableOpacity>
          </SafeAreaView>
        </ImageBackground>
      </Modal>
    </View>
  );
}

export default SearchableSelect;

const styles = StyleSheet.create({
  background: { flex: 1 },
  container: { marginBottom: 16, width: "100%" },

  input: {
    backgroundColor: palette.glass.control,
    borderRadius: 12,
    padding: 12,
    color: palette.glass.ink,
    fontSize: 16,
    width: "100%"
  },
  activity: { marginVertical: 20 },
  modalContainer: {
    flex: 1,
    margin: 12,
    borderRadius: 24,
    padding: 20,
    backgroundColor: palette.glass.header
  },

  searchInput: {
    borderWidth: 1,
    borderColor: palette.glass.edge,
    borderRadius: 10,
    padding: 12,
    marginBottom: 10
  },

  item: {
    padding: 15,
    borderBottomWidth: 1,
    borderColor: palette.colors.background
  },

  create: {
    marginTop: 10,
    backgroundColor: palette.glass.ink,
    padding: 12,
    borderRadius: 8,
    alignItems: "center"
  },

  closeButton: {
    marginTop: 15,
    alignItems: "center"
  },

  errorInput: {
    borderColor: palette.colors.red
  },
  error: { color: palette.colors.red, marginTop: 4, fontSize: 12 }
});
